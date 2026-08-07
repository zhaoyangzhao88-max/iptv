/* Real HLS playback probe: drives the real OWL IPTV renderer pipeline
 * (player.js + pinned local hls.js 1.6.16) against a public HLS test stream.
 * Evidence is written to test-evidence/<RUN>. Exit 0 only when the video
 * reaches readyState>=2 AND currentTime advances (frames actually moving). */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const PLAY_URL = process.env.PLAY_URL;
const RUN = process.env.RUN_NAME || 'real-playback-public-hls';
if (!PLAY_URL) {
  console.error('PLAY_URL is required');
  process.exit(2);
}

const APP_DIR = path.resolve(__dirname, '..');
const evidenceDir = path.join(APP_DIR, 'test-evidence', RUN);
fs.mkdirSync(evidenceDir, { recursive: true });
const screenshotPath = path.join(evidenceDir, 'frame.png');
const statePath = path.join(evidenceDir, 'playback-state.json');
const logPath = path.join(evidenceDir, 'renderer-console.log');

const consoleLines = [];
let app;

function redact(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth|sig|sign|pass|password|credential/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    url.hash = '';
    return url.toString();
  } catch (_) {
    return value.replace(/https?:\/\/[^\s]+/gi, '[redacted-url]');
  }
}

(async () => {
  try {
    const electronBin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
    const userDataDir = path.join(evidenceDir, 'user-data');
    fs.mkdirSync(userDataDir, { recursive: true });
    app = await electron.launch({
      executablePath: electronBin,
      args: [`--user-data-dir=${userDataDir}`, APP_DIR],
      timeout: 30000,
      env: { ...process.env },
    });

    const page = await app.firstWindow();
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      consoleLines.push(line);
      process.stdout.write(`renderer ${line}\n`);
    });
    page.on('pageerror', (error) => {
      const line = `[pageerror] ${error.message}`;
      consoleLines.push(line);
      process.stdout.write(`renderer ${line}\n`);
    });
    page.on('requestfailed', (request) => {
      const line = `[requestfailed] ${request.method()} ${redact(request.url())} :: ${request.failure()?.errorText || 'unknown'}`;
      consoleLines.push(line);
      process.stdout.write(`renderer ${line}\n`);
    });

    await page.waitForSelector('#video-element', { timeout: 15000 });
    await page.waitForFunction(() => window.owlIptv?.playChannel, null, { timeout: 15000 });
    process.stdout.write('app ready, invoking playChannel\n');

    await page.evaluate(() => { window.__owlPlaybackEvents = []; });
    const eventNames = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error', 'suspend'];
    for (const name of eventNames) {
      await page.locator('#video-element').evaluate((video, eventName) => {
        video.addEventListener(eventName, () => window.__owlPlaybackEvents.push(eventName));
      }, name);
    }

    const channelName = `Public Test Stream ${RUN}`;
    await page.evaluate(({ channelName, url }) => {
      window.owlIptv.playChannel({ name: channelName, routes: [{ url }], delay_ms: 0 });
    }, { channelName, url: PLAY_URL });
    process.stdout.write('playChannel invoked, waiting for media\n');

    await page.waitForTimeout(15000);

    const sample = () => page.evaluate(() => {
      const video = document.querySelector('#video-element');
      const current = document.querySelector('#current-channel');
      return {
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        ended: video.ended,
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        error: video.error ? { code: video.error.code, message: video.error.message || '' } : null,
        src: video.currentSrc || '',
      };
    });
    const t1 = await sample();
    await page.waitForTimeout(4000);
    const t2 = await sample();

    const state = {
      stream: redact(PLAY_URL),
      t1,
      t2,
      framesAdvanced: t2.currentTime > t1.currentTime && t1.currentTime > 0,
      hlsEvents: await page.evaluate(() => window.__owlPlaybackEvents || []),
      hlsSupported: await page.evaluate(() => !!(window.Hls && window.Hls.isSupported())),
    };
    await page.screenshot({ path: screenshotPath, fullPage: false });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    fs.writeFileSync(logPath, consoleLines.join('\n') + '\n');
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');

    const ok = t2.readyState >= 2 && state.framesAdvanced;
    process.exitCode = ok ? 0 : 3;
    process.stdout.write(ok ? 'REAL-PLAYBACK OK\n' : 'REAL-PLAYBACK NOT CONFIRMED\n');
  } catch (error) {
    process.stderr.write(`probe failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
  }
})();

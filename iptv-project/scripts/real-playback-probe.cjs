const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const evidenceDir = path.join(APP_DIR, 'test-evidence', process.env.EVIDENCE_RUN || 'real-playback');
fs.mkdirSync(evidenceDir, { recursive: true });
const screenshotPath = path.join(evidenceDir, 'hebei-tv.png');
const statePath = path.join(evidenceDir, 'playback-state.json');
const logPath = path.join(evidenceDir, 'renderer-console.log');
const mainLogPath = path.join(evidenceDir, 'main-process.log');

const consoleLines = [];
const mainLines = [];
const events = [];
let app;

function recordEvent(name, detail) {
  events.push({ name, detail: detail || null, at: new Date().toISOString() });
}

function redact(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth|sig|sign|pass|password|credential/i.test(key)) url.searchParams.set(key, '[redacted]');
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

    await page.waitForSelector('#channel-grid', { timeout: 15000 });
    await page.waitForFunction(() => window.owlIptv?.getChannels, null, { timeout: 15000 });
    const before = await page.evaluate(() => ({
      channels: window.owlIptv.getChannels().map((channel) => ({ name: channel.name, url: channel.url, routeCount: channel.routes?.length || 0 })),
      cardCount: document.querySelectorAll('#channel-grid .channel-card').length,
    }));
    process.stdout.write(`channels=${before.channels.length} cards=${before.cardCount}\n`);

    const hebeiCard = page.locator('#channel-grid .channel-card').filter({ hasText: '河北卫视' }).first();
    if (await hebeiCard.count() === 0) throw new Error('河北卫视 card not found');
    await page.evaluate(() => { window.__owlPlaybackEvents = []; });
    const eventNames = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error'];
    for (const name of eventNames) {
      await page.locator('#video-element').evaluate((video, eventName) => {
        video.addEventListener(eventName, () => window.__owlPlaybackEvents.push(eventName), { once: false });
      }, name);
    }
    await hebeiCard.evaluate((element) => element.click());
    recordEvent('hebei-card-clicked');
    await page.waitForTimeout(12000);

    const state = await page.evaluate(() => {
      const video = document.querySelector('#video-element');
      const current = document.querySelector('#current-channel');
      const latency = document.querySelector('#current-latency');
      return {
        currentChannel: current?.textContent?.trim() || '',
        currentLatency: latency?.textContent?.trim() || '',
        video: video ? {
          src: video.src || '',
          currentSrc: video.currentSrc || '',
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          ended: video.ended,
          currentTime: video.currentTime,
          error: video.error ? { code: video.error.code, message: video.error.message || '' } : null,
        } : null,
        hls: window.owlIptv?._getHls?.() ? { exists: true, mediaAttached: !!window.owlIptv._getHls().media } : { exists: false },
        events: window.__owlPlaybackEvents || [],
      };
    });
    state.channels = before.channels;
    state.cardCount = before.cardCount;
    state.events = events;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    fs.writeFileSync(logPath, consoleLines.join('\n') + '\n');
    fs.writeFileSync(mainLogPath, mainLines.join('\n') + '\n');
    process.stdout.write(JSON.stringify({ evidenceDir, screenshotPath, statePath, state }, null, 2) + '\n');
    process.exitCode = state.video && state.video.readyState >= 2 ? 0 : 2;
  } catch (error) {
    process.stderr.write(`probe failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
  }
})();

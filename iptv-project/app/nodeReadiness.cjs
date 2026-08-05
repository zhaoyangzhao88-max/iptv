const http = require('http');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 100;

function requestHealth({ host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = DEFAULT_INTERVAL_MS, request = http.request }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    };
    const req = request({ host, port, path: '/health', method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding?.('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          finish(reject, new Error(`health returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          finish(resolve, body ? JSON.parse(body) : {});
        } catch (_) {
          finish(reject, new Error('health returned invalid JSON'));
        }
      });
    });
    req.on('error', (error) => finish(reject, error));
    timer = setTimeout(() => {
      req.destroy?.();
      finish(reject, new Error('health check request timed out'));
    }, timeoutMs);
    req.end?.();
  });
}

async function waitForHealth({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  request = http.request,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  isChildAlive = () => true
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error('health check timed out');
  while (Date.now() < deadline) {
    if (!isChildAlive()) throw new Error('Node microservice exited before readiness');
    try {
      const remaining = deadline - Date.now();
      const payload = await requestHealth({
        host,
        port,
        timeoutMs: Math.max(1, Math.min(intervalMs || DEFAULT_INTERVAL_MS, remaining)),
        request,
      });
      return { ready: true, host, port, health: payload };
    } catch (error) {
      lastError = error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(intervalMs, remaining));
    }
  }
  throw new Error(`Node microservice readiness failed: ${lastError.message}`);
}

function stopChild(child, { timeoutMs = 3000, killSignal = 'SIGKILL' } = {}) {
  if (!child || child.killed || child.exitCode !== null) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (killed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(killed);
    };
    child.once?.('exit', () => finish(false));
    child.kill?.('SIGTERM');
    timer = setTimeout(() => {
      if (!settled && child.exitCode === null) {
        child.kill?.(killSignal);
        finish(true);
      } else finish(false);
    }, timeoutMs);
  });
}

module.exports = { waitForHealth, stopChild, NODE_READINESS_DEFAULTS: { host: DEFAULT_HOST, port: DEFAULT_PORT, timeoutMs: DEFAULT_TIMEOUT_MS } };

import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const readiness = await import('../app/nodeReadiness.cjs');
const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const indexHtml = await readFile(resolve(projectRoot, 'app/index.html'), 'utf8');

 test('release package uses an exact local Hls.js bundle and declares maintainer metadata', async () => {
  assert.equal(packageJson.dependencies?.['hls.js'], '1.6.16');
  assert.match(indexHtml, /<script src="\.\.\/node_modules\/hls\.js\/dist\/hls\.min\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /cdn\.jsdelivr\.net|hls\.js@latest/);
  assert.equal(packageJson.author, 'Zhao Yang');
  assert.equal(packageJson.build?.win?.icon, undefined, 'icon stays unset until official brand asset exists');
  await readFile(resolve(projectRoot, 'node_modules/hls.js/dist/hls.min.js'));
});

function response(statusCode, body) {
  const emitter = new EventEmitter();
  emitter.statusCode = statusCode;
  emitter.setEncoding = () => {};
  queueMicrotask(() => {
    emitter.emit('data', JSON.stringify(body));
    emitter.emit('end');
  });
  return emitter;
}

function requestFactory(sequence) {
  return (_options, callback) => {
    const req = new EventEmitter();
    queueMicrotask(() => {
      const item = sequence.shift();
      if (item instanceof Error) req.emit('error', item);
      else callback(response(item?.statusCode || 200, item?.body || { status: 'ok' }));
    });
    return req;
  };
}

test('waitForHealth retries until the loopback service is ready', async () => {
  const result = await readiness.waitForHealth({
    timeoutMs: 100,
    intervalMs: 0,
    request: requestFactory([new Error('not ready'), { statusCode: 200, body: { status: 'ok' } }]),
    sleep: async () => {},
    isChildAlive: () => true
  });
  assert.deepEqual(result, { ready: true, host: '127.0.0.1', port: 3000, health: { status: 'ok' } });
});

test('waitForHealth times out a health request that never completes', async () => {
  const requests = [];
  const request = (_options, _callback) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    requests.push(req);
    return req;
  };
  await assert.rejects(
    readiness.waitForHealth({ timeoutMs: 20, intervalMs: 5, request, sleep: async () => {}, isChildAlive: () => true }),
    /readiness failed: health check request timed out/
  );
  assert.equal(requests[0].destroyed, true);
});
test('waitForHealth fails when child exits before readiness', async () => {
  await assert.rejects(
    readiness.waitForHealth({ timeoutMs: 50, request: requestFactory([new Error('down')]), sleep: async () => {}, isChildAlive: () => false }),
    /exited before readiness/
  );
});

test('stopChild waits for exit and does not force-kill a graceful child', async () => {
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGTERM') {
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0));
    }
  };
  const killed = await readiness.stopChild(child, { timeoutMs: 20 });
  assert.equal(killed, false);
  assert.deepEqual(signals, ['SIGTERM']);
});

test('stopChild force-kills a child that ignores SIGTERM', async () => {
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  const signals = [];
  child.kill = (signal) => { signals.push(signal); if (signal === 'SIGKILL') child.killed = true; };
  const killed = await readiness.stopChild(child, { timeoutMs: 5 });
  assert.equal(killed, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

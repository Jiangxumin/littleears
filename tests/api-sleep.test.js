const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { installStubs } = require('./helpers/stub-deps');

installStubs();
const router = require('../routes/api');
const playerManager = require('../services/player-manager');

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/api', router);
  return a;
}

async function post(path, body) {
  const server = buildApp().listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally {
    server.close();
  }
}

test('/api/sleep 合法值 → 启动，返回 sleepRemaining', async () => {
  playerManager.stop();
  const { status, json } = await post('/api/sleep', { minutes: 30 });
  assert.strictEqual(status, 200);
  assert.ok(json.sleepRemaining <= 1800 && json.sleepRemaining > 1795);
});

test('/api/sleep minutes:0 → 取消', async () => {
  playerManager.stop();
  await post('/api/sleep', { minutes: 30 });
  const { json } = await post('/api/sleep', { minutes: 0 });
  assert.strictEqual(json.sleepRemaining, null);
});

test('/api/sleep >480 → 400', async () => {
  const { status } = await post('/api/sleep', { minutes: 481 });
  assert.strictEqual(status, 400);
});

test('/api/sleep 负数 → 400', async () => {
  const { status } = await post('/api/sleep', { minutes: -1 });
  assert.strictEqual(status, 400);
});

test('/api/sleep 非数字 → 400', async () => {
  const { status } = await post('/api/sleep', { minutes: 'x' });
  assert.strictEqual(status, 400);
});

test('/api/next {auto:true} 命中标志 → 停', async () => {
  playerManager.stop();
  playerManager.startQueue(['a.mp3', 'b.mp3'], 'browser', 0);
  playerManager.stopAfterCurrent = true;
  const { json } = await post('/api/next', { auto: true });
  assert.strictEqual(json.state, 'idle');
});

test('/api/next 手动(无 auto) 不查标志 → 切歌', async () => {
  playerManager.stop();
  playerManager.startQueue(['a.mp3', 'b.mp3'], 'browser', 0);
  playerManager.stopAfterCurrent = true;
  const { json } = await post('/api/next', undefined);
  assert.strictEqual(json.currentFile, 'b.mp3');
});

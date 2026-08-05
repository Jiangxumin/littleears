const { test } = require('node:test');
const assert = require('node:assert');
const { installStubs } = require('./helpers/stub-deps');

installStubs(); // 必须在 require player-manager 之前
const manager = require('../services/player-manager');

function fresh() {
  manager.stop();
  manager.setPlayMode('sequential');
}

test('startSleepTimer 设置 sleepRemaining ≈ minutes*60', () => {
  fresh();
  manager.startSleepTimer(30);
  const s = manager.getStatus();
  assert.ok(s.sleepRemaining <= 1800 && s.sleepRemaining > 1795, `got ${s.sleepRemaining}`);
  assert.strictEqual(s.sleepFireSeq, 0);
});

test('cancelSleepTimer 清倒计时但不清序号', () => {
  fresh();
  manager.startSleepTimer(30);
  manager._onSleepFire();
  const seq = manager.sleepFireSeq;
  manager.cancelSleepTimer();
  assert.strictEqual(manager.getStatus().sleepRemaining, null);
  assert.strictEqual(manager.sleepFireSeq, seq);
});

test('_onSleepFire 正在播放 → 序号+1、立标志、暂停', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  // sleepFireSeq 单调递增、跨用例不重置，故断言相对增量而非绝对值
  const before = manager.sleepFireSeq;
  manager._onSleepFire();
  assert.strictEqual(manager.sleepFireSeq, before + 1);
  assert.strictEqual(manager.stopAfterCurrent, true);
  assert.strictEqual(manager.state, 'paused');
});

test('_onSleepFire 已暂停 → 只立标志，不误恢复', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  manager.togglePause();
  manager._onSleepFire();
  assert.strictEqual(manager.state, 'paused');
  assert.strictEqual(manager.stopAfterCurrent, true);
});

test('_onSleepFire 空闲 → 只立标志，无副作用', () => {
  fresh();
  manager._onSleepFire();
  assert.strictEqual(manager.stopAfterCurrent, true);
  assert.strictEqual(manager.state, 'idle');
});

test('_onSleepFire 后 sleepRemaining 归 null（前端据此隐藏倒计时/解锁）', () => {
  fresh();
  manager.startQueue(['a.mp3'], 'server', 0);
  manager.startSleepTimer(30);
  assert.ok(manager.getStatus().sleepRemaining != null);
  manager._onSleepFire();
  assert.strictEqual(manager.getStatus().sleepRemaining, null);
  assert.strictEqual(manager.sleepTimerId, null); // 句柄已清除（不阻塞进程）
  assert.strictEqual(manager.stopAfterCurrent, true); // 兜底标志仍在（不随到点清除）
});

test('_advanceAuto 命中标志 → stop', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  manager.stopAfterCurrent = true;
  manager._advanceAuto();
  assert.strictEqual(manager.state, 'idle');
  assert.strictEqual(manager.stopAfterCurrent, false);
});

test('onEnded 命中标志 → 停，不进下一首', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  manager.stopAfterCurrent = true;
  manager.onEnded();
  assert.strictEqual(manager.state, 'idle');
});

test('onEnded 未命中标志 → 正常进下一首', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  manager.onEnded();
  assert.strictEqual(manager.currentFile, 'b.mp3');
});

test('next({auto:true}) 命中标志 → 停（浏览器自动播完）', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  manager.stopAfterCurrent = true;
  const r = manager.next({ auto: true });
  assert.strictEqual(r.state, 'idle');
});

test('next() 手动不查标志 → 正常切歌且标志保留', () => {
  fresh();
  manager.startQueue(['a.mp3', 'b.mp3'], 'server', 0);
  manager.stopAfterCurrent = true;
  const r = manager.next();
  assert.strictEqual(r.currentFile, 'b.mp3');
  assert.strictEqual(manager.stopAfterCurrent, true);
});

test('startQueue 清除 stopAfterCurrent', () => {
  fresh();
  manager.stopAfterCurrent = true;
  manager.startQueue(['a.mp3'], 'server', 0);
  assert.strictEqual(manager.stopAfterCurrent, false);
});

test('stop 清除定时器与标志', () => {
  fresh();
  manager.startQueue(['a.mp3'], 'server', 0);
  manager.startSleepTimer(30);
  manager.stopAfterCurrent = true;
  manager.stop();
  assert.strictEqual(manager.sleepTimerId, null);
  assert.strictEqual(manager.getStatus().sleepRemaining, null);
  assert.strictEqual(manager.stopAfterCurrent, false);
});

test('队列自然播完(sequential 越界) → stop 连带清定时', () => {
  fresh();
  manager.startQueue(['a.mp3'], 'server', 0);
  manager.startSleepTimer(30);
  manager.onEnded();
  assert.strictEqual(manager.state, 'idle');
  assert.strictEqual(manager.getStatus().sleepRemaining, null);
});

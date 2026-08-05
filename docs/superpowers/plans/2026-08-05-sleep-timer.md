# 定时暂停（Sleep Timer）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「定时暂停」功能——用户选择 小时+分钟 启动定时，到点后停止继续放音（双保险：尽力立即暂停 + stopAfterCurrent 兜底）。

**Architecture:** 后端 `player-manager` 持有 `setTimeout`（跨页面存活）。到点立 `stopAfterCurrent` 标志 + 尽力 `togglePause`；标志仅在**自动推进**路径（服务端 `onEnded` / 浏览器 `/api/next {auto:true}`）检查，手动「下一首」是用户覆盖、不查标志。`sleepFireSeq` 单调序号供前端按事件同步浏览器暂停。前端控件独立于 `#player` 常驻可见。

**Tech Stack:** Node.js (>=18, 实测 v22) + Express + EJS。测试用 Node 内置 `node:test` + `node:assert`（零依赖，符合项目极简风格）。

## Global Constraints

- Node `>=18`；不新增运行时依赖（测试仅用内置模块，express 已是依赖）。
- UI 中文文案；强调色 `#e07a5f`，卡片白底 `#fff`，圆角 12px，文字 `#4a3f35`/`#8a7f72`（见 `public/css/style.css`）。
- 改动前端静态资源（`app.js`/`style.css`）后，递增 `views/index.ejs` 里的 `?v=` 缓存版本号。
- 后端单例：`services/player-manager.js` 末尾 `module.exports = new PlayerManager()`。
- 现有 `STATE = { IDLE:'idle', PLAYING:'playing', PAUSED:'paused' }`；`PLAY_MODE = { SINGLE, SEQUENTIAL, SHUFFLE }`。

## File Structure

- **Create** `tests/helpers/stub-deps.js` — 通过 `require.cache` 注入 scanner/player-server/player-browser 桩，避免真实 `pkill`/声卡副作用，使 player-manager 与路由可单测。
- **Create** `tests/player-manager.test.js` — 核心逻辑单测（定时、标志、auto/手动推进、清除时机）。
- **Create** `tests/api-sleep.test.js` — `/api/sleep` 校验 + `/api/next {auto}` 透传的集成测试（挂载 router + fetch）。
- **Modify** `services/player-manager.js` — 新增 sleep 状态/方法、`_advanceAuto()`、改 `onEnded`/`next`/`_status`/`startQueue`/`stop`。
- **Modify** `routes/api.js` — 新增 `POST /api/sleep`；`/api/next` 透传 `auto`。
- **Modify** `views/index.ejs` — 新增独立 `.sleepbar` 控件；递增 `?v=`。
- **Modify** `public/css/style.css` — `.sleepbar*` 样式 + 移动端适配。
- **Modify** `public/js/app.js` — sleep 元素引用、`syncSleep`、`startSleep`/取消、轮询两模式、`<audio>` ended 传 `auto:true`。
- **Modify** `package.json` — 增加 `"test": "node --test"` 脚本。

---

### Task 1: player-manager 定时暂停核心逻辑（TDD）

**Files:**
- Create: `tests/helpers/stub-deps.js`
- Create: `tests/player-manager.test.js`
- Modify: `services/player-manager.js`
- Modify: `package.json`

**Interfaces:**
- Produces（供 Task 2/3 使用）：
  - `playerManager.startSleepTimer(totalMinutes:number):void`
  - `playerManager.cancelSleepTimer():void`
  - `playerManager.next({auto=false}:{auto?:boolean}={}):{ok,state,...}`
  - `playerManager.onEnded():void`（行为变更：命中 `stopAfterCurrent` 则停）
  - `playerManager._advanceAuto():void`（新增；自动推进统一入口）
  - `_status()` 新增字段 `sleepRemaining:number|null`、`sleepFireSeq:number`
  - 状态：`sleepTimerId`、`sleepEndsAt`、`stopAfterCurrent`、`sleepFireSeq`

- [ ] **Step 1: 加 test 脚本 + 写桩依赖助手**

`package.json` 的 `scripts` 改为：

```json
"scripts": {
  "start": "node server.js",
  "dev": "node --watch server.js",
  "test": "node --test"
}
```

创建 `tests/helpers/stub-deps.js`：

```js
/**
 * 测试桩：通过 require.cache 注入 scanner / player-server / player-browser 桩，
 * 避免 player-manager 加载时触发真实 player-server 的 pkill / 声卡副作用。
 * 每个 node --test worker 独立，互不污染。
 */
const Module = require('module');
const path = require('path');

const svcDir = path.join(__dirname, '..', '..', 'services');

function installStubs() {
  const scannerStub = { toAbsPath: (p) => p };
  const playerServerStub = {
    play: () => {}, stop: () => {}, pause: () => {}, resume: () => {},
    getVolume: () => 50, setVolume: () => 50,
  };
  const playerBrowserStub = { streamUrl: (f) => '/api/stream?f=' + encodeURIComponent(f) };

  const inject = (rel, stub) => {
    const fakePath = path.join(svcDir, rel + '.js');
    const m = new Module(fakePath, module);
    m.filename = fakePath;
    m.loaded = true;
    m.paths = Module._nodeModulePaths(path.dirname(fakePath));
    m.exports = stub;
    require.cache[fakePath] = m;
  };
  inject('scanner', scannerStub);
  inject('player-server', playerServerStub);
  inject('player-browser', playerBrowserStub);
  return { scannerStub, playerServerStub, playerBrowserStub };
}

module.exports = { installStubs };
```

- [ ] **Step 2: 写失败测试**

创建 `tests/player-manager.test.js`：

```js
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
  manager._onSleepFire();
  assert.strictEqual(manager.sleepFireSeq, 1);
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
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npm test`
Expected: FAIL（`startSleepTimer is not a function` / `_advanceAuto is not a function` 等）。

- [ ] **Step 4: 实现 player-manager 改动**

**4a. 构造函数加状态**（`services/player-manager.js` 构造函数末尾，`this.pausedElapsed = 0;` 之后）：

```js
    this.pausedElapsed = 0;
    // 定时暂停（sleep timer）
    this.sleepTimerId = null;       // setTimeout 句柄
    this.sleepEndsAt = null;        // 到点时间戳（轮询算剩余用）
    this.stopAfterCurrent = false;  // 到点兜底：自动推进时停，不进下一首
    this.sleepFireSeq = 0;          // 到点序号（单调递增，前端按事件同步用）
```

**4b. `startQueue` 清标志**（在 `this.playedSet = new Set();` 之后加一行）：

```js
    this.playedSet = new Set();
    this.stopAfterCurrent = false; // 新会话不继承 sleep 兜底标志
    this.outputMode = outputMode;
```

**4c. `next` 增加 `{auto}` 参数**（替换整个 `next()` 方法）：

```js
  /** 下一首：手动切歌，或浏览器/服务端自动播完（auto:true） */
  next({ auto = false } = {}) {
    if (this.state === STATE.IDLE) return { ok: false, error: '未在播放' };
    if (auto) {
      // 自动推进：受 stopAfterCurrent 约束，到队尾即停
      this._advanceAuto();
    } else if (this.playMode === PLAY_MODE.SEQUENTIAL && this.index + 1 >= this.queue.length) {
      this._playAt(0); // 手动 next：顺序队尾 → 回第一首
    } else if (this.playMode === PLAY_MODE.SHUFFLE) {
      if (this.playedSet.size >= this.queue.length) this.playedSet.clear();
      this._advanceShuffle();
    } else {
      this._advance(); // 手动 next：single 重播 / sequential 中段前进
    }
    return { ok: true, ...this._status() };
  }
```

> 行为说明：手动 `next()` 逻辑与原版完全一致（顺序队尾仍回绕）；仅新增 `auto` 分支。`auto` 走 `_advanceAuto` → `_advance`，故**浏览器模式自动播完在「顺序」队尾由「回绕」改为「停止」**，与服务端 `onEnded` 及文档「自动播完→队尾即停」对齐（这是有意的一致性修正）。

**4d. `onEnded` 改走 `_advanceAuto`**（替换 `onEnded()` 方法）：

```js
  /** 播放结束回调（server 子进程自然退出时触发） */
  onEnded() {
    if (this.state !== STATE.PLAYING) return;
    this._advanceAuto();
  }
```

**4e. 新增 `_advanceAuto` + sleep 三方法**（放在 `_advance()` 方法之后、`_advanceShuffle()` 之前）：

```js
  /** 自动推进（自然播完）：受 stopAfterCurrent 约束，命中即停 */
  _advanceAuto() {
    if (this.stopAfterCurrent) {
      this.stopAfterCurrent = false;
      this.stop();
      return;
    }
    this._advance();
  }

  // ---------- 定时暂停（sleep timer） ----------

  /** 启动定时暂停（totalMinutes 分钟后到点） */
  startSleepTimer(totalMinutes) {
    this.cancelSleepTimer();
    this.sleepEndsAt = Date.now() + totalMinutes * 60000;
    this.sleepTimerId = setTimeout(() => this._onSleepFire(), totalMinutes * 60000);
  }

  /** 取消定时暂停（不清 sleepFireSeq：序号只增不减） */
  cancelSleepTimer() {
    if (this.sleepTimerId) {
      clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
    }
    this.sleepEndsAt = null;
    this.stopAfterCurrent = false;
  }

  /**
   * 到点回调：立兜底标志 + 尽力立即暂停。
   * check-then-act 依赖 Node 单线程事件循环的同步性（回调内无 await，不会被中断）；
   * 若未来引入 async，需重新评估此处竞态。
   */
  _onSleepFire() {
    this.sleepFireSeq++;
    this.stopAfterCurrent = true;
    if (this.state === STATE.PLAYING) this.togglePause();
  }
```

**4f. `stop` 清定时与标志**（在 `stop()` 方法的 `this.pausedElapsed = 0;` 之后加）：

```js
    this.pausedElapsed = 0;
    // 定时暂停：结束会话即清除（队列播完 / 手动停止都会走这里）
    if (this.sleepTimerId) {
      clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
    }
    this.sleepEndsAt = null;
    this.stopAfterCurrent = false;
```

**4g. `_status` 加字段**（在 `_status()` 返回对象里，`volume: playerServer.getVolume(),` 之后加两行）：

```js
      volume: playerServer.getVolume(),
      sleepRemaining: this.sleepEndsAt
        ? Math.max(0, Math.floor((this.sleepEndsAt - Date.now()) / 1000))
        : null,
      sleepFireSeq: this.sleepFireSeq,
```

- [ ] **Step 5: 运行测试，确认全过**

Run: `npm test`
Expected: 所有 player-manager 测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json tests/helpers/stub-deps.js tests/player-manager.test.js services/player-manager.js
git commit -m "feat: 定时暂停核心逻辑(player-manager) + 单测"
```

---

### Task 2: API 端点 `/api/sleep` 与 `/api/next {auto}`（TDD）

**Files:**
- Create: `tests/api-sleep.test.js`
- Modify: `routes/api.js`

**Interfaces:**
- Consumes: Task 1 的 `startSleepTimer` / `cancelSleepTimer` / `next({auto})` / `getStatus()`。
- Produces：
  - `POST /api/sleep {minutes}` → 校验 `0<=minutes<=480`，越界/非数字 `400`；`0` 取消；返回 `{ok, ...status}`（含 `sleepRemaining`/`sleepFireSeq`）。
  - `POST /api/next {auto?:true}` → 透传 `auto`。

- [ ] **Step 1: 写失败测试**

创建 `tests/api-sleep.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: `/api/sleep` 相关用例 FAIL（404 或无 sleepRemaining）；`/api/next` auto 用例 FAIL。

- [ ] **Step 3: 实现 `/api/sleep` 与 `/api/next` auto 透传**

在 `routes/api.js` 中：

**3a. `/api/next` 透传 auto**（替换现有 `router.post('/next', ...)`）：

```js
/** 下一首（手动切歌 / 浏览器模式 ended 后；auto:true=自动推进） */
router.post('/next', (req, res) => {
  const { auto } = req.body || {};
  const result = playerManager.next({ auto: !!auto });
  if (!result.ok) return res.status(400).json(result);

  // 浏览器模式需要返回下一首 URL
  if (result.outputMode === 'browser' && result.currentFile) {
    result.url = playerBrowser.streamUrl(result.currentFile);
  }
  res.json(result);
});
```

**3b. 新增 `/api/sleep`**（放在 `/api/playMode` 路由之后）：

```js
/** 定时暂停：minutes 分钟后到点暂停；0 = 取消 */
router.post('/sleep', (req, res) => {
  const { minutes } = req.body || {};
  if (typeof minutes !== 'number' || isNaN(minutes) || minutes < 0 || minutes > 480) {
    return res.status(400).json({ error: 'minutes 须为 0-480 的数字' });
  }
  if (minutes === 0) playerManager.cancelSleepTimer();
  else playerManager.startSleepTimer(minutes);
  res.json({ ok: true, ...playerManager.getStatus() });
});
```

- [ ] **Step 4: 运行测试，确认全过**

Run: `npm test`
Expected: 所有测试 PASS（player-manager + api-sleep）。

- [ ] **Step 5: 提交**

```bash
git add tests/api-sleep.test.js routes/api.js
git commit -m "feat: /api/sleep 定时端点 + /api/next auto 透传"
```

---

### Task 3: 前端 UI 与接线（手动验证）

> 说明：项目无前端测试框架（无 jsdom/playwright），引入仅为此功能违反 YAGNI。前端用实现 + 手动验证；核心逻辑已由 Task 1/2 的后端测试覆盖。

**Files:**
- Modify: `views/index.ejs`
- Modify: `public/css/style.css`
- Modify: `public/js/app.js`

- [ ] **Step 1: EJS 加独立 sleepbar 控件 + 缓存号递增**

在 `views/index.ejs` 的 `</header>`（第 27 行）之后、`<main class="content">` 之前插入：

```html
  <!-- 定时暂停：独立于 #player，常驻可见（不随 idle 隐藏） -->
  <section class="sleepbar" id="sleepTimer">
    <span class="sleepbar__icon">⏲</span>
    <select id="sleepHours" class="sleepbar__select" aria-label="定时小时">
      <option value="0">0时</option>
      <option value="1">1时</option>
      <option value="2">2时</option>
      <option value="3">3时</option>
      <option value="4">4时</option>
      <option value="5">5时</option>
      <option value="6">6时</option>
      <option value="7">7时</option>
      <option value="8">8时</option>
    </select>
    <select id="sleepMins" class="sleepbar__select" aria-label="定时分钟">
      <option value="0">0分</option>
      <option value="15">15分</option>
      <option value="30">30分</option>
      <option value="45">45分</option>
    </select>
    <button class="sleepbar__btn" id="btnSleepStart">启动定时</button>
    <span class="sleepbar__countdown" id="sleepCountdown" hidden></span>
    <button class="sleepbar__cancel" id="btnSleepCancel" hidden title="取消定时">✕</button>
  </section>
```

递增静态资源缓存号（`<head>` 与底部 `<script>` 两处）：

```html
  <link rel="stylesheet" href="/css/style.css?v=20260807">
```
```html
  <script src="/js/app.js?v=20260807"></script>
```

- [ ] **Step 2: CSS 加 sleepbar 样式**

在 `public/css/style.css` 末尾（`/* ---------- 移动端适配 ---------- */` 之前）插入：

```css
/* ---------- 定时暂停 ---------- */
.sleepbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 24px;
  padding: 10px 16px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(74, 63, 53, 0.06);
}
.sleepbar__icon { font-size: 1.1rem; }
.sleepbar__select {
  padding: 6px 10px;
  border: 2px solid #e0d5c6;
  border-radius: 18px;
  background: #fff;
  color: #4a3f35;
  font-size: 0.9rem;
  cursor: pointer;
}
.sleepbar__btn {
  padding: 6px 16px;
  border: none;
  border-radius: 18px;
  background: #e07a5f;
  color: #fff;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.sleepbar__btn:hover { background: #d96f52; }
.sleepbar__btn:active { transform: scale(0.94); }
.sleepbar__countdown { font-size: 0.9rem; font-weight: 600; color: #e07a5f; }
.sleepbar__cancel {
  width: 28px; height: 28px;
  border: none; border-radius: 50%;
  background: #f7efe3; color: #8a7f72;
  font-size: 0.9rem; cursor: pointer;
}
.sleepbar__cancel:hover { background: #ffe8df; color: #e07a5f; }
```

并在移动端 `@media (max-width: 600px)` 块内（`.content, .player { margin-left:10px; ... }` 那条规则里）追加 `.sleepbar`：

```css
  .content,
  .player,
  .sleepbar {
    margin-left: 10px;
    margin-right: 10px;
  }
```

- [ ] **Step 3: app.js 加 DOM 引用**

在 `public/js/app.js` 的 `const volumeValueEl = ...`（第 29 行附近）之后加：

```js
  const sleepHoursEl = document.getElementById('sleepHours');
  const sleepMinsEl = document.getElementById('sleepMins');
  const sleepCountdownEl = document.getElementById('sleepCountdown');
  const btnSleepStart = document.getElementById('btnSleepStart');
  const btnSleepCancel = document.getElementById('btnSleepCancel');
```

- [ ] **Step 4: app.js 加 sleep 逻辑**

在「循环模式」区块之后（`document.querySelector('.player__modes')...` 那段之后，约第 77 行后）插入：

```js
  // ================= 定时暂停 =================
  let lastSleepFireSeq = null; // null = 尚未从后端初始化

  // 由 status 刷新倒计时 + 按到点事件同步浏览器暂停
  function syncSleep(status) {
    if (!status) return;
    if (lastSleepFireSeq === null) lastSleepFireSeq = status.sleepFireSeq; // 首次仅初始化
    if (status.sleepRemaining == null) {
      sleepCountdownEl.hidden = true;
      btnSleepCancel.hidden = true;
      lastSleepFireSeq = status.sleepFireSeq; // 无活动定时：对齐基线（后端重启恢复）
      return;
    }
    sleepCountdownEl.hidden = false;
    btnSleepCancel.hidden = false;
    sleepCountdownEl.textContent = `⏲ 剩余 ${formatTime(status.sleepRemaining)}`;
    // 到点事件：序号递增 → 浏览器暂停一次（音箱模式后端已直接暂停）
    if (status.sleepFireSeq > lastSleepFireSeq) {
      lastSleepFireSeq = status.sleepFireSeq;
      if (mode === 'browser') audioEl.pause();
    }
  }

  async function startSleep() {
    const minutes = Number(sleepHoursEl.value) * 60 + Number(sleepMinsEl.value);
    const res = await api('/api/sleep', { method: 'POST', body: { minutes } });
    if (res && res.sleepFireSeq != null) lastSleepFireSeq = res.sleepFireSeq; // 启动即对齐
    syncSleep(res);
  }

  btnSleepStart.addEventListener('click', startSleep);
  btnSleepCancel.addEventListener('click', async () => {
    const res = await api('/api/sleep', { method: 'POST', body: { minutes: 0 } });
    syncSleep(res);
  });
```

- [ ] **Step 5: app.js 轮询改为两模式都跑**

替换现有的 `setInterval`（约第 384 行）：

```js
  // ================= 音箱模式轮询 + 定时同步（两模式都跑） =================
  setInterval(async () => {
    const status = await api('/api/status');
    syncSleep(status);
    if (mode === 'server') updatePlayerUI(status);
  }, 2000);
```

- [ ] **Step 6: app.js 浏览器 ended 传 auto:true**

替换 `<audio>` 的 `ended` 监听（约第 324 行）：

```js
  // 播完自动下一首（auto:true = 自动推进，受定时兜底约束）
  audioEl.addEventListener('ended', async () => {
    const res = await api('/api/next', { method: 'POST', body: { auto: true } });
    if (res.url) {
      audioEl.src = res.url;
      audioEl.play();
      updatePlayerUI(res);
    } else {
      updatePlayerUI(null); // 队列播完（或定时命中）→ 收起播放器
    }
  });
```

- [ ] **Step 7: 手动验证（浏览器）**

Run: `npm start`（或 `npm run dev`），浏览器打开应用。

Expected：
1. sleepbar 常驻可见（即便未播放）。
2. 选 0时15分 → 启动 → 出现「⏲ 剩余 0:15」「✕」；每 2s 倒计时递减。
3. 点 ✕ → 倒计时消失。
4. 浏览器模式播放 → 设 0时0分... （用最小可观察：临时把 `startSleepTimer` 测试用 1 分钟，或信任后端单测）；到点 → 音频暂停、播放器变 ⏸。
5. 音箱模式：到点 → UI 变 ⏸（后端暂停音箱）。

- [ ] **Step 8: 提交**

```bash
git add views/index.ejs public/css/style.css public/js/app.js
git commit -m "feat: 定时暂停前端 UI(小时+分钟) 与轮询同步"
```

---

### Task 4: 全量测试 + 端到端手测

**Files:** 无代码改动（仅验证；如发现问题回对应 Task 修复）。

- [ ] **Step 1: 跑全部自动化测试**

Run: `npm test`
Expected: player-manager + api-sleep 全部 PASS。

- [ ] **Step 2: 启动服务冒烟**

Run: `npm start`
Expected: 服务正常启动，无报错；`GET /api/status` 返回含 `sleepRemaining:null`、`sleepFireSeq:0`。

验证（另一终端）：
```bash
curl -s localhost:3000/api/status | head -c 300   # 端口以 config 为准
```

- [ ] **Step 3: 端到端手测清单（音箱模式，树莓派）**

- [ ] 播放一个多曲目录（顺序模式）→ 设 1 分钟定时（或最小档）→ 到点音箱静音。
- [ ] 若暂停未即时生效：等当前曲播完 → 确认**不接下一首**（兜底命中）。
- [ ] 到点后点「下一首」→ 切到下一首正常播放（手动覆盖）；该首播完后停（标志保留命中）。
- [ ] 设定时后点 ✕ 取消 → 倒计时消失，到点不再暂停。
- [ ] 浏览器模式：到点 → `<audio>` 暂停；随后手动 `audioEl.play()` 恢复 → **不会被下一次轮询再次暂停**（无反馈循环）。
- [ ] 锁屏/关闭页面后 reopen → 定时仍按后端时间到点生效。

- [ ] **Step 4: 收尾**

确认 `git status` 干净（均已提交）。无需额外 commit（本任务无代码改动）。

---

## Self-Review（已自查）

- **Spec 覆盖**：§3.1 全部方法/状态 → Task 1；§3.2 端点与校验 → Task 2；§3.3 UI/轮询/seq 同步/基线对齐 → Task 3；§5 边界（队列播完清定时、手动 vs 自动）→ Task 1 测试 + Task 4 手测；§6 测试要点 → Task 1/2/4。无遗漏。
- **占位符**：无 TBD/TODO；每步含完整代码。
- **类型/命名一致**：`startSleepTimer`/`cancelSleepTimer`/`_advanceAuto`/`next({auto})`/`sleepRemaining`/`sleepFireSeq`/`stopAfterCurrent` 在 Task 1 定义，Task 2/3 消费，全串一致。
- **已知行为变更（已注明）**：浏览器模式「顺序」自动播完在队尾由回绕改为停止（Task 1 Step 4c），与服务端及文档意图对齐；手动 next 行为不变。

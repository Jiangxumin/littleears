# 定时暂停（Sleep Timer）设计

- 日期：2026-08-05
- 目标：新增「定时暂停」功能。用户选择 小时 + 分钟（分钟按 15 分钟一档）启动定时，到点后停止继续放音。哄睡主场景：音箱模式后台端驱动，家长设好后可锁屏/关页面。

## 1. 方案选择

**选定：后端持有定时器**（`player-manager.js` 中的 `setTimeout`）。

否决「纯前端定时」：音箱模式下音频由树莓派后端子进程播放，家长通常会锁屏/收起手机/关闭页面，前端定时器会随页面销毁而失效，导致音乐放一整夜。定时器必须活在后端 Node 进程里才能跨页面存活。

## 2. 到点行为（双保险）

定时到点时（timer 回调）依次做两件事，二者互补、不冲突：

1. **立 `stopAfterCurrent` 标志（兜底）** —— 在 `_advance()`（每首自然播完时被调用）最前面检查：若标志为真则 `stop()`，不再播下一首。即使「立即暂停」没生效，当前这首播完后也绝不自动接下一首。
2. **尝试立即暂停（首选，追求马上安静）** —— 仅当 `state === PLAYING` 时调用 `togglePause()`（避免把已暂停的曲子误恢复）。

| 到点时状态 | 行为 |
|---|---|
| 正在播放 | 立即暂停 + 立 `stopAfterCurrent` 标志（音箱尽力静音，浏览器必静音；暂停失败则由标志兜底） |
| 已暂停 | 只立标志（不误恢复） |
| 空闲 | 只立标志（无副作用） |
| 其后当前曲播完 | 标志命中 → `stop()`，不进下一首 |

`stopAfterCurrent` 在以下时机清除：新的播放会话 `startQueue()`、`cancelSleepTimer()`。

## 3. 组件设计

### 3.1 `services/player-manager.js`

新增状态：
- `sleepTimerId` —— `setTimeout` 句柄。
- `sleepEndsAt` —— 到点时间戳（`Date.now() + 总分钟*60000`），供轮询计算剩余。
- `stopAfterCurrent` —— 布尔标志。
- `sleepFireSeq` —— 单调递增的「到点序号」（初始 0），每次到点 `++`。供前端**按事件**同步浏览器暂停，避免按状态同步造成的反馈循环（见 3.3）。

新增方法：
- `startSleepTimer(totalMinutes)`：清旧定时 → 设新 `setTimeout(分钟*60000, () => this._onSleepFire())` → 记 `sleepEndsAt`。
- `cancelSleepTimer()`：`clearTimeout(sleepTimerId)`、置空 `sleepEndsAt`、清 `stopAfterCurrent`（**不**清 `sleepFireSeq`，序号只增不减）。
- `_onSleepFire()`：`this.sleepFireSeq++; this.stopAfterCurrent = true; if (this.state === STATE.PLAYING) this.togglePause();`

改动：
- `_advance()` 顶部：`if (this.stopAfterCurrent) { this.stopAfterCurrent = false; this.stop(); return; }`
- `startQueue()`：开头清 `stopAfterCurrent`（新会话不继承旧标志）。
- `stop()`：清定时（停止播放即视为结束会话）。
- `_status()`：新增 `sleepRemaining`（秒，向下取整；无定时为 `null`）= `sleepEndsAt ? Math.max(0, Math.floor((sleepEndsAt - Date.now())/1000)) : null`；以及 `sleepFireSeq`（数字）。

### 3.2 `routes/api.js`

- 新增 `POST /api/sleep`，body `{ minutes: number }`：`minutes <= 0` → `cancelSleepTimer()`；否则 `startSleepTimer(minutes)`。返回 `{ ok: true, sleepRemaining, sleepFireSeq }`。
- 剩余时间与到点序号经现有 `GET /api/status` 的 `sleepRemaining` / `sleepFireSeq` 字段返回（无需新端点）。

### 3.3 `views/index.ejs` + `public/js/app.js`

UI（播放器区内新增一行）：
- 两个 `<select>`：小时（0–8）、分钟（0 / 15 / 30 / 45）。
- ⏲「启动定时」按钮：计算 `总分钟 = 小时*60 + 分钟` → `POST /api/sleep`。`0` 视为取消。
- 激活时显示倒计时文本（如「⏲ 剩余 28:14」）+ ✕「取消」按钮（→ `POST /api/sleep {minutes:0}`）。

轮询同步（扩展现有 2s 轮询为**两种输出模式都跑**）：
- 渲染倒计时：读 `status.sleepRemaining`，`null` 则隐藏。
- **按到点事件同步浏览器暂停**（关键）：前端记录上次见到的 `sleepFireSeq`；当 `status.sleepFireSeq > lastSleepFireSeq` 时视为「刚刚到点」→ 更新 `lastSleepFireSeq`，并在浏览器模式 `audioEl.pause()` 一次。**不**根据 `state==='paused'` 来暂停——那样会在用户手动恢复后把音频再次暂停（反馈循环）。序号只在到点时递增，故每次到点只暂停一次，之后用户可自由恢复。
- 音箱模式：后端已直接暂停音箱，轮询仅刷新 UI 为 ⏸；`sleepFireSeq` 变化时无需额外动作。

## 4. 数据流

1. 用户选 0h30m → 点「启动定时」→ `POST /api/sleep {minutes:30}` → `startSleepTimer(30)` → `setTimeout(30min)`，记 `sleepEndsAt`。
2. 前端 2s 轮询 `GET /api/status` → 读 `sleepRemaining` 显示倒计时。
3. 到点 → `_onSleepFire()`：`sleepFireSeq++`、立 `stopAfterCurrent` 标志 + 暂停。音箱静音（或当前曲播完后停）；浏览器经轮询发现 `sleepFireSeq` 变化 → `audioEl.pause()` 一次。
4. 取消：点「取消」→ `POST /api/sleep {minutes:0}` → `cancelSleepTimer()`。

## 5. 边界情况

- 到点时已暂停 → 只立标志，不误恢复。
- 到点时空闲 → 只立标志，无副作用。
- 新定时覆盖旧的（`startSleepTimer` 先清旧）。
- `0h0m` 或「取消」→ 清除定时与标志。
- 后端重启会清掉内存中的定时（`setTimeout` 不持久化）—— 可接受，文档注明；哄睡场景下重启属异常事件。
- 关闭/锁屏页面 → 定时照常到点（后端方案的核心收益）。

## 6. 测试要点

- 后端单测（mock `player-server`/`scanner`，同既有探针法）：
  - 启动 30min 定时 → `sleepEndsAt` 约 30min 后；`sleepRemaining` 随时间递减。
  - 到点 + 正在播放 → `sleepFireSeq` 递增、`state` 变 `paused`、`stopAfterCurrent === true`。
  - 到点 + 已暂停 → `state` 仍 `paused`、标志置真、**未误变 playing**。
  - 标志命中：`_advance()` → `stop()`，不进下一首。
  - `startQueue` 后标志被清，正常连播恢复。
  - `cancelSleepTimer` 后 `sleepRemaining === null`（`sleepFireSeq` 不重置）。
  - 前端：`sleepFireSeq` 变化时浏览器音频暂停一次；模拟用户随后 `audioEl.play()` 恢复，确认**不会被下一次轮询再次暂停**（无反馈循环）。
- 手测（树莓派音箱模式）：设 1 分钟（或最小档）定时 → 到点音箱静音；若暂停未生效，等当前曲播完确认不接下一首。

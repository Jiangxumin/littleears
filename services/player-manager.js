/**
 * player-manager.js — 播放管理器（M2 核心）
 *
 * 职责：管理整个播放系统的「大脑」：
 *  - 播放队列（单曲 / 目录展开）
 *  - 三种循环模式：single(单曲) / sequential(顺序) / shuffle(随机)
 *  - 两种输出模式：server(音箱) / browser(浏览器)
 *  - 播放状态机：IDLE → PLAYING ⇄ PAUSED → IDLE
 *
 * 数据流：
 *  前端点击 → /api/play → manager.startQueue(queue, outputMode)
 *    → player-server.play(file, onEnd)   [音箱模式]
 *    → 返回 url 给前端 <audio>            [浏览器模式]
 *  播放结束 → onEnded() → 按 playMode 决定下一首 → 循环
 *
 * 关键设计：
 *  - 队列存「相对路径」，文件系统扫描时解析为绝对路径
 *  - shuffle 不重复：维护 playedSet 记录已播，全部播完即停
 *  - server 模式由后端驱动（子进程 exit 回调推进）；
 *    browser 模式由前端驱动（<audio> ended 后调 /api/next）
 */
const scanner = require('./scanner');
const playerServer = require('./player-server');

const STATE = { IDLE: 'idle', PLAYING: 'playing', PAUSED: 'paused' };
const PLAY_MODE = { SINGLE: 'single', SEQUENTIAL: 'sequential', SHUFFLE: 'shuffle' };

class PlayerManager {
  constructor() {
    this.state = STATE.IDLE;
    this.playMode = PLAY_MODE.SEQUENTIAL; // 默认顺序播放
    this.outputMode = 'server'; // 默认音箱

    this.queue = []; // 相对路径数组
    this.index = 0; // 当前队列位置
    this.playedSet = new Set(); // 已播过的索引（shuffle 用）

    this.currentFile = null; // 当前播放文件相对路径
    this.startedAt = null; // 播放开始时间戳（计时进度用）
    this.pausedElapsed = 0; // 暂停前累计秒数
  }

  // ---------- 对外接口 ----------

  /**
   * 开始播放队列
   * @param {string[]} queue 相对路径数组（目录展开全部；单文件 = 同目录全部）
   * @param {string} outputMode server | browser
   * @param {number} startIndex 起始位置（单文件播放时指向点击的文件）
   */
  startQueue(queue, outputMode, startIndex = 0) {
    if (!queue.length) return;
    this.queue = [...queue];
    this.index = 0;
    this.playedSet = new Set();
    this.outputMode = outputMode;
    this._playAt(Math.min(startIndex, queue.length - 1));
  }

  /** 手动下一首（也供浏览器模式结束后调用） */
  next() {
    if (this.state === STATE.IDLE) return { ok: false, error: '未在播放' };
    // 手动切歌与自动播完语义不同：
    //  - 自动播完(onEnded) → 队尾即停（spec 设计）
    //  - 手动 next → 队尾循环回第一首，进度框不消失
    if (this.playMode === PLAY_MODE.SEQUENTIAL && this.index + 1 >= this.queue.length) {
      this._playAt(0); // 顺序模式队尾 → 回第一首
    } else if (this.playMode === PLAY_MODE.SHUFFLE) {
      if (this.playedSet.size >= this.queue.length) this.playedSet.clear(); // 播完一轮重置
      this._advanceShuffle();
    } else {
      this._advance(); // single：重播同一首
    }
    return { ok: true, ...this._status() };
  }

  /** 暂停 / 恢复 */
  togglePause() {
    if (this.state === STATE.PLAYING) {
      playerServer.pause();
      this.state = STATE.PAUSED;
      this.pausedElapsed = this._elapsedSeconds();
      return { ok: true, paused: true };
    }
    if (this.state === STATE.PAUSED) {
      playerServer.resume();
      this.state = STATE.PLAYING;
      this.startedAt = Date.now() - this.pausedElapsed * 1000; // 校正计时
      return { ok: true, paused: false };
    }
    return { ok: false, error: '未在播放' };
  }

  /** 停止播放，回到空闲 */
  stop() {
    playerServer.stop();
    this.state = STATE.IDLE;
    this.queue = [];
    this.playedSet = new Set();
    this.currentFile = null;
    this.startedAt = null;
    this.pausedElapsed = 0;
  }

  /** 设置循环模式 */
  setPlayMode(mode) {
    if (Object.values(PLAY_MODE).includes(mode)) {
      this.playMode = mode;
      this.playedSet.clear(); // 切换模式重置已播记录
    }
  }

  /** 当前状态（供 /api/status 和前端轮询） */
  getStatus() {
    return this._status();
  }

  // ---------- 内部逻辑 ----------

  /** 播放队列第 index 首 */
  _playAt(index) {
    if (index >= this.queue.length) {
      this.stop(); // 队列播完
      return;
    }
    this.index = index;
    this.currentFile = this.queue[index];
    this.playedSet.add(index);
    this.startedAt = Date.now();
    this.pausedElapsed = 0;
    this.state = STATE.PLAYING;

    const absPath = scanner.toAbsPath(this.currentFile);
    console.log(`▶ ${this.playMode} ${this.index + 1}/${this.queue.length}: ${this.currentFile}`);

    if (this.outputMode === 'server') {
      // 音箱模式：后端子进程播放，exit 回调推进
      playerServer.play(absPath, () => this.onEnded());
    }
    // browser 模式：由前端 <audio> 播放，结束后调 /api/next
  }

  /** 播放结束回调（server 子进程自然退出时触发） */
  onEnded() {
    if (this.state !== STATE.PLAYING) return;
    this._advance();
  }

  /** 按循环模式决定下一首 */
  _advance() {
    switch (this.playMode) {
      case PLAY_MODE.SINGLE:
        // 单曲循环：重播同一首
        this._playAt(this.index);
        break;
      case PLAY_MODE.SEQUENTIAL:
        this._playAt(this.index + 1); // 超界时 stop
        break;
      case PLAY_MODE.SHUFFLE:
        this._advanceShuffle();
        break;
    }
  }

  /** shuffle：从未播过的索引中随机选，全部播完即停 */
  _advanceShuffle() {
    const remaining = [];
    for (let i = 0; i < this.queue.length; i++) {
      if (!this.playedSet.has(i)) remaining.push(i);
    }
    if (remaining.length === 0) {
      this.stop();
      return;
    }
    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    this._playAt(pick);
  }

  /** 已播放秒数（暂停时保持） */
  _elapsedSeconds() {
    if (!this.startedAt) return 0;
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  /** 组装状态对象 */
  _status() {
    return {
      state: this.state,
      playMode: this.playMode,
      outputMode: this.outputMode,
      currentFile: this.currentFile,
      currentIndex: this.index,
      queueLength: this.queue.length,
      elapsed: this.state === STATE.PLAYING ? this._elapsedSeconds() : this.pausedElapsed,
    };
  }
}

module.exports = new PlayerManager(); // 单例

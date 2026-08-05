/**
 * api.js — API 路由（M2 版本）
 *
 * 端点：
 *  GET  /api/files     文件树
 *  POST /api/play      播放 { path, mode, playMode }，path 可为文件或目录
 *  POST /api/next      下一首（浏览器模式 ended 后也调这个）
 *  POST /api/pause     暂停 / 恢复
 *  POST /api/stop      停止
 *  POST /api/playMode  设置循环模式 { playMode }
 *  POST /api/sleep     定时暂停 { minutes }，0 = 取消
 *  GET  /api/status    当前播放状态
 */
const express = require('express');
const path = require('path');
const config = require('../config');

const scanner = require('../services/scanner');
const playerServer = require('../services/player-server');
const playerBrowser = require('../services/player-browser');
const playerManager = require('../services/player-manager');

const router = express.Router();

/** 获取文件树 */
router.get('/files', (req, res) => {
  res.json(scanner.getTree());
});

/** 重新扫描文件目录（新增/删除音频后调用，无需重启服务） */
router.post('/refresh', (req, res) => {
  const tree = scanner.refresh();
  res.json({ ok: true, fileCount: countFiles(tree) });
});

/** 统计文件树中的音频文件数 */
function countFiles(node) {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((sum, c) => sum + countFiles(c), 0);
}

/**
 * 播放：path 可以是文件或目录
 *  - 文件 → 单曲队列
 *  - 目录 → 递归收集全部音频
 * mode 为 server（音箱）或 browser（浏览器）
 */
router.post('/play', (req, res) => {
  const { path: relPath, mode, playMode } = req.body || {};
  if (!relPath) return res.status(400).json({ error: '缺少 path' });

  // 路径安全校验
  const abs = scanner.toAbsPath(relPath);
  if (!abs) return res.status(400).json({ error: '非法路径' });

  // 收集播放队列
  let queue;
  let startIndex = 0;
  if (path.extname(relPath)) {
    // 文件：单曲。队列 = 同目录全部音频，起始 = 当前文件
    // 这样「下一首」只在当前目录内切换（不跨目录），到队尾循环回第一首
    if (!scanner.isAudioFile(abs)) return res.status(400).json({ error: '不支持的音频格式' });
    const dirRel = path.dirname(relPath);
    queue = scanner.collectDirAudio(dirRel);
    startIndex = queue.indexOf(relPath);
    if (startIndex === -1) { queue = [relPath]; startIndex = 0; } // 兜底：目录扫描失败则单曲
  } else {
    // 目录：递归收集
    queue = scanner.collectDirAudio(relPath);
    if (!queue.length) return res.status(400).json({ error: '目录中没有音频' });
  }

  if (playMode) playerManager.setPlayMode(playMode);
  playerManager.startQueue(queue, mode || 'server', startIndex);

  // 统一返回 { ok, ...status }，浏览器模式附 url
  const resp = { ok: true, ...playerManager.getStatus() };
  if (mode === 'browser') {
    resp.url = playerBrowser.streamUrl(queue[startIndex]);
  }
  res.json(resp);
});

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

/** 暂停 / 恢复 */
router.post('/pause', (req, res) => {
  const result = playerManager.togglePause();
  res.json({ ...result, ...playerManager.getStatus() });
});

/** 停止 */
router.post('/stop', (req, res) => {
  playerManager.stop();
  res.json({ ok: true });
});

/** 设置循环模式 */
router.post('/playMode', (req, res) => {
  const { playMode } = req.body || {};
  if (!playMode) return res.status(400).json({ error: '缺少 playMode' });
  playerManager.setPlayMode(playMode);
  res.json({ ok: true, playMode: playerManager.playMode });
});

/** 定时暂停：minutes 分钟后到点暂停；0 = 取消 */
router.post('/sleep', (req, res) => {
  const { minutes } = req.body || {};
  if (typeof minutes !== 'number' || isNaN(minutes) || minutes < 0 || minutes > 540) {
    return res.status(400).json({ error: 'minutes 须为 0-540 的数字' });
  }
  if (minutes === 0) playerManager.cancelSleepTimer();
  else playerManager.startSleepTimer(minutes);
  res.json({ ok: true, ...playerManager.getStatus() });
});

/** 播放状态 */
router.get('/status', (req, res) => {
  res.json(playerManager.getStatus());
});

/** 设置音箱音量 { volume: 0-100 }（立即重启当前曲生效） */
router.post('/volume', (req, res) => {
  const { volume } = req.body || {};
  if (typeof volume !== 'number' || isNaN(volume)) {
    return res.status(400).json({ error: '缺少有效的 volume' });
  }
  const applied = playerManager.setVolume(volume);
  res.json({ ok: true, volume: applied });
});

module.exports = router;

/**
 * api.js — API 路由
 *
 * M1 提供两个端点：
 *  - GET  /api/files  文件树
 *  - POST /api/play   播放 { filePath, mode }
 */
const express = require('express');
const path = require('path');
const config = require('../config');

const scanner = require('../services/scanner');
const playerServer = require('../services/player-server');
const playerBrowser = require('../services/player-browser');

const router = express.Router();

/** 获取文件树 */
router.get('/files', (req, res) => {
  res.json(scanner.getTree());
});

/** 停止音箱播放 */
router.post('/stop', (req, res) => {
  playerServer.stop();
  res.json({ ok: true });
});

/** 播放音频 */
router.post('/play', (req, res) => {
  const { filePath, mode } = req.body || {};
  if (!filePath) return res.status(400).json({ error: '缺少 filePath' });

  // 安全校验：解析后的绝对路径必须位于 mediaRoot 内，防止路径穿越
  const abs = path.resolve(config.mediaRoot, filePath);
  if (!abs.startsWith(config.mediaRoot + path.sep)) {
    return res.status(400).json({ error: '非法路径' });
  }
  if (!scanner.isAudioFile(abs)) {
    return res.status(400).json({ error: '不支持的音频格式' });
  }

  if (mode === 'server') {
    playerServer.play(abs, () => {
      // M1: 播放自然结束后回到空闲（M2 将加入循环模式）
      console.log('  播放结束');
    });
    res.json({ ok: true, mode: 'server' });
  } else {
    // mode === 'browser'：后端只返回流 URL，播放由前端 <audio> 完成
    res.json({ ok: true, mode: 'browser', url: playerBrowser.streamUrl(filePath) });
  }
});

module.exports = router;

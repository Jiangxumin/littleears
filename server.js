/**
 * LittleEars — 入口文件
 *
 * 职责：组装 Express 应用（中间件、路由、静态资源），启动 HTTP 服务。
 */
const express = require('express');
const path = require('path');
const config = require('./config');

const apiRouter = require('./routes/api');
const playerBrowser = require('./services/player-browser');

const app = express();

// ---------- 中间件 ----------
app.use(express.json()); // 解析 POST 请求的 JSON body
app.use(express.static(path.join(__dirname, 'public'))); // 静态资源: /css, /js
playerBrowser.mount(app); // 音频文件流: /media/*

// ---------- 页面 ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
  res.render('index', { title: 'LittleEars' });
});

// ---------- API ----------
app.use('/api', apiRouter);

// ---------- 启动 ----------
app.listen(config.port, '0.0.0.0', () => {
  console.log(`🎧 LittleEars 已启动: http://0.0.0.0:${config.port}`);
  console.log(`  音频目录: ${config.mediaRoot}`);
});

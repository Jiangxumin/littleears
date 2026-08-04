/**
 * LittleEars — 入口文件
 *
 * 职责：组装 Express 应用（中间件、路由、静态资源），启动 HTTP 服务。
 *
 * 中间件顺序很关键：
 *  1. body 解析（json / urlencoded）
 *  2. 公开静态资源 /css /js /favicon（登录页需要，不受认证限制）
 *  3. /login 登录路由（必须在 auth 之前）
 *  4. auth 认证中间件（之后的路由都需要登录）
 *  5. /media 音频流（受 auth 保护，否则直接访问 URL 绕过认证）
 *  6. / 主页、/api 接口
 */
const express = require('express');
const path = require('path');
const config = require('./config');

const apiRouter = require('./routes/api');
const playerBrowser = require('./services/player-browser');
const { auth, TOKEN } = require('./middleware/auth');

const app = express();

// ---------- 1. body 解析 ----------
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // 解析登录表单

// ---------- 2. 公开静态资源（登录页要用，不经过 auth） ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 3. 登录路由（auth 之前） ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/login', (req, res) => {
  // 未配置密码时直接回首页（auth 会放行）
  if (!config.password) return res.redirect('/');
  res.render('login', { error: '' });
});

app.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!config.password) return res.redirect('/');
  if (password === config.password) {
    // 设置 30 天有效期的 session cookie
    res.cookie('le_auth', TOKEN, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    return res.redirect('/');
  }
  res.render('login', { error: '密码错误，请重试' });
});

app.get('/logout', (req, res) => {
  res.clearCookie('le_auth');
  res.redirect('/login');
});

// ---------- 4. 认证中间件（之后所有路由需登录） ----------
app.use(auth);

// ---------- 5. 音频流（受 auth 保护） ----------
playerBrowser.mount(app);

// ---------- 6. 主页 + API ----------
app.get('/', (req, res) => {
  // 传 authEnabled 给前端：启用认证时显示退出按钮
  // （HttpOnly cookie 前端读不到，需服务端告知）
  res.render('index', { title: 'LittleEars', authEnabled: !!config.password });
});

app.use('/api', apiRouter);

// ---------- 启动 ----------
app.listen(config.port, '0.0.0.0', () => {
  console.log(`🎧 LittleEars 已启动: http://0.0.0.0:${config.port}`);
  console.log(`  音频目录: ${config.mediaRoot}`);
  console.log(`  认证: ${config.password ? '已启用（需登录）' : '未启用（局域网免密）'}`);
});

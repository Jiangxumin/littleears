/**
 * auth.js — 密码认证中间件（cookie session）
 *
 * 设计：
 *  - password 为空（默认）→ 全部放行，局域网免密访问
 *  - 配置 password 后 → 公网访问需登录，保护未授权访问
 *
 * 为什么用 cookie session 而非 HTTP Basic Auth？
 *  - <audio> 标签拉流时不带 Basic Auth 凭据头，会导致认证后音频无法播放
 *  - cookie 同源自动携带，<audio> 请求能带上，与流媒体兼容
 *
 * 流程：未认证 → 页面重定向 /login；API → 401 JSON
 */
const crypto = require('crypto');
const config = require('../config');

// 基于 password 生成稳定 token（密码不变则 token 不变，重启服务也不影响已登录会话）
const TOKEN = config.password
  ? crypto.createHash('sha256').update(config.password).digest('hex')
  : null;

// 白名单：登录页及其静态资源无需认证（否则登录页都打不开）
const PUBLIC_PREFIXES = ['/login', '/css/', '/js/', '/favicon.svg'];

function isPublic(path) {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

/** 手动解析 Cookie 头 → 对象（避免引入 cookie-parser 依赖） */
function parseCookies(cookieHeader) {
  const obj = {};
  if (!cookieHeader) return obj;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    obj[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return obj;
}

/** 认证中间件 */
function auth(req, res, next) {
  // 未配置密码 → 局域网免密，全部放行
  if (!config.password) return next();

  // 公开路径放行
  if (isPublic(req.path)) return next();

  // 检查 session cookie
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.le_auth === TOKEN) return next();

  // 未认证：API 返回 JSON，页面重定向登录
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ error: '未认证，请先登录' });
  }
  return res.redirect('/login');
}

module.exports = { auth, TOKEN };

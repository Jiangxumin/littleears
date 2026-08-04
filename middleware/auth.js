/**
 * auth.js — 密码认证中间件（cookie session）
 *
 * 访问策略（配置 password 后生效）：
 *  - 局域网来源（私有 IP）→ 永久免密，直接放行
 *  - 公网来源 → 需登录（cookie session），保护未授权访问
 *  - 未配置 password → 全部放行
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

/**
 * 判断 IP 是否为局域网（私有地址 / 回环）
 * RFC1918 私有段 + 回环 + 链路本地：
 *  - 10.0.0.0/8
 *  - 172.16.0.0/12
 *  - 192.168.0.0/16
 *  - 127.0.0.0/8（本机）
 *  - ::1, fc00::/7, fe80::/10（IPv6）
 */
function isPrivateIp(ip) {
  if (!ip) return false;
  // IPv6 回环与私有
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return true;
  }
  // 去掉 IPv4 映射的 IPv6 前缀 ::ffff:
  const v4 = ip.replace(/^::ffff:/, '');
  const parts = v4.split('.');
  if (parts.length !== 4) return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 ||                         // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||          // 192.168.0.0/16
    a === 127                            // 127.0.0.0/8
  );
}

/** 获取请求来源 IP（优先 X-Forwarded-For，适用于反向代理/端口映射场景） */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

/** 认证中间件 */
function auth(req, res, next) {
  // 未配置密码 → 全部放行
  if (!config.password) return next();

  // 局域网来源 → 永久免密
  if (isPrivateIp(getClientIp(req))) return next();

  // 公开路径放行
  if (isPublic(req.path)) return next();

  // 公网来源：检查 session cookie
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.le_auth === TOKEN) return next();

  // 未认证：API 返回 JSON，页面重定向登录
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ error: '未认证，请先登录' });
  }
  return res.redirect('/login');
}

module.exports = { auth, TOKEN, isPrivateIp };

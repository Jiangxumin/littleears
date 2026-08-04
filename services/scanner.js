/**
 * scanner.js — 音频文件扫描器
 *
 * 职责：递归扫描 media 目录，把「文件夹 → 音频文件」结构转成 JSON 树，
 * 前端据此渲染可折叠的文件树。
 *
 * 设计要点：
 *  - 「文件即数据库」：新增音频只需拷贝到目录，刷新即可看到
 *  - 带缓存：目录结构不会频繁变化，避免每次请求都全盘扫描
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let cache = null; // 扫描结果缓存

const isAudioFile = (name) => {
  const ext = path.extname(name).toLowerCase();
  return config.audioExtensions.includes(ext);
};

/**
 * 自然排序比较器：把数字段按数值比较，其余按字符串比较
 * 例如: 1-a, 2-a, 3-a, ..., 10-a, 11-a (而不是 1, 10, 11, 2)
 */
const compareNatural = (a, b) => {
  const re = /(\d+)|(\D+)/g;
  const pa = a.match(re) || [];
  const pb = b.match(re) || [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const numX = /^\d+$/.test(x), numY = /^\d+$/.test(y);
    if (numX && numY) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x.localeCompare(y, 'zh-Hans-CN');
    }
  }
  return 0;
};

// 按名称自然排序：目录在前，文件在后
const compareName = (a, b) => {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return compareNatural(a.name, b.name);
};

/**
 * 递归扫描目录，返回节点树
 * @param {string} dir 目录绝对路径
 * @param {string} relPath 相对 mediaRoot 的路径（用于前端标识文件）
 */
function scanDir(dir, relPath) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    // 跳过隐藏文件和目录
    if (entry.name.startsWith('.')) continue;

    const childAbs = path.join(dir, entry.name);
    const childRel = path.join(relPath, entry.name);

    if (entry.isDirectory()) {
      const sub = scanDir(childAbs, childRel);
      if (sub.children.length > 0) children.push(sub);
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      children.push({
        name: entry.name,
        type: 'file',
        path: childRel, // 相对路径作为文件的唯一标识
      });
    }
  }

  children.sort(compareName);

  return {
    name: path.basename(dir) || relPath,
    type: 'directory',
    path: relPath,
    children,
  };
}

/** 获取文件树（带缓存） */
function getTree() {
  if (!cache) cache = scanDir(config.mediaRoot, '');
  return cache;
}

/** 强制重新扫描（新增音频后调用） */
function refresh() {
  cache = scanDir(config.mediaRoot, '');
  return cache;
}

module.exports = { getTree, refresh, isAudioFile };

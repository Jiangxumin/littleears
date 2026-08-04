/**
 * player-browser.js — 浏览器播放器
 *
 * 职责：把 media 目录以静态资源形式暴露给浏览器，前端 <audio> 标签直接播放。
 *
 * 关键点：express.static 基于 send 库实现，自动支持 HTTP Range 请求
 * （拖动进度条、跳转播放需要它），也自动处理 MIME 类型和路径穿越防护。
 */
const express = require('express');
const config = require('../config');

/**
 * 挂载 /media 静态服务
 * @param {object} app Express 应用实例
 */
function mount(app) {
  app.use('/media', express.static(config.mediaRoot));
}

/**
 * 把文件相对路径转成浏览器可访问的 URL
 * @param {string} relPath 相对 mediaRoot 的路径，如 "廖彩杏/Brown Bear.mp3"
 * @returns {string} 如 "/media/廖彩杏/Brown%20Bear.mp3"
 */
function streamUrl(relPath) {
  // encodeURI 保留中文，只编码空格等特殊字符
  return `/media/${encodeURI(relPath)}`;
}

module.exports = { mount, streamUrl };

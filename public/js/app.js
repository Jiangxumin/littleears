/**
 * app.js — 前端交互逻辑
 *
 * M1 功能：
 *  - 加载并渲染文件树（可折叠目录）
 *  - 切换播放模式：音箱 / 浏览器
 *  - 点击音频文件播放
 */
(() => {
  'use strict';

  // 默认音箱播放：磨耳朵主场景是「音箱出声」，浏览器是辅助
  let mode = localStorage.getItem('le_mode') || 'server';

  const fileTreeEl = document.getElementById('fileTree');
  const audioEl = document.getElementById('audio');
  const nowPlayingEl = document.getElementById('nowPlaying');
  const nowPlayingNameEl = document.getElementById('nowPlayingName');

  // ---------- 播放模式切换 ----------
  // 切换时停止旧播放：旧模式的声音必须立即关闭，否则两个声音同时响
  async function stopCurrentPlayback() {
    // 无论当前是哪种模式，两端都清一遍（幂等）
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (e) {
      /* 网络失败忽略 */
    }
  }

  // 同步按钮高亮（初始化时也要调用，不触发停止）
  function syncModeUI() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function setMode(newMode) {
    if (newMode === mode) return; // 同模式切换无需处理
    mode = newMode;
    localStorage.setItem('le_mode', newMode);
    syncModeUI();
    stopCurrentPlayback(); // 切模式 → 停止之前的声音
  }

  document.getElementById('modeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });

  // ---------- 播放 ----------
  async function playFile(relPath) {
    const name = relPath.split('/').pop();
    setNowPlaying(`▶ ${name}`);

    if (mode === 'server') {
      // 音箱模式：告诉后端去播，浏览器这边保持静默
      const res = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: relPath, mode: 'server' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNowPlaying(`❌ ${data.error || '播放失败'}`);
      }
    } else {
      // 浏览器模式：后端返回流 URL，交给 <audio> 播放
      const res = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: relPath, mode: 'browser' }),
      });
      const data = await res.json();
      if (data.url) {
        audioEl.src = data.url;
        audioEl.play();
      }
    }
  }

  function setNowPlaying(text) {
    nowPlayingEl.hidden = false;
    nowPlayingNameEl.textContent = text;
  }

  // ---------- 文件树渲染 ----------
  // 递归把 JSON 树渲染成可折叠的 <ul>/<li> 列表
  function renderTree(node, isRoot) {
    const ul = document.createElement('ul');
    ul.className = 'tree';

    for (const child of node.children) {
      const li = document.createElement('li');

      if (child.type === 'directory') {
        // 目录：可折叠，点击标题展开/收起
        li.className = 'tree-item tree-item--dir';

        const label = document.createElement('div');
        label.className = 'dir-label';
        label.textContent = `📁 ${child.name}/`;

        const nested = renderTree(child, false);
        nested.hidden = true; // 默认收起

        label.addEventListener('click', () => {
          nested.hidden = !nested.hidden;
        });

        li.append(label, nested);
      } else {
        // 文件：点击播放
        li.className = 'tree-item tree-item--file';
        li.textContent = `🎵 ${child.name}`;
        li.addEventListener('click', () => playFile(child.path));
      }

      ul.append(li);
    }

    return ul;
  }

  // 用 textContent 安全地设置提示文字（避免 XSS）
  function showLoading(message) {
    fileTreeEl.replaceChildren(); // 清空所有子节点
    const p = document.createElement('p');
    p.className = 'loading';
    p.textContent = message;
    fileTreeEl.append(p);
  }

  async function loadTree() {
    showLoading('加载中…');
    try {
      const res = await fetch('/api/files');
      const tree = await res.json();
      fileTreeEl.replaceChildren();
      fileTreeEl.append(renderTree(tree, true));
    } catch (err) {
      showLoading(`加载失败: ${err.message}`);
    }
  }

  // ---------- 初始化 ----------
  syncModeUI(); // 只同步按钮高亮，不触发停止（页面加载时没有在播放）
  loadTree();
})();

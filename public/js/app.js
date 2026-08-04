/**
 * app.js — 前端交互逻辑（M2）
 *
 * 功能：
 *  - 文件树渲染（可折叠，目录带播放按钮）
 *  - 播放模式切换：音箱 / 浏览器（切换自动停止）
 *  - 循环模式：单曲 🔂 / 顺序 🔁 / 随机 🔀
 *  - 播放控制：暂停/恢复、上一首、下一首、停止、进度条
 *  - 浏览器模式：<audio> 播放，ended 自动下一首
 *  - 音箱模式：轮询 /api/status 同步状态
 */
(() => {
  'use strict';

  let mode = localStorage.getItem('le_mode') || 'server'; // 默认音箱
  let playMode = localStorage.getItem('le_playMode') || 'sequential';

  const fileTreeEl = document.getElementById('fileTree');
  const playerEl = document.getElementById('player');
  const playerIconEl = document.getElementById('playerIcon');
  const playerNameEl = document.getElementById('playerName');
  const playerCountEl = document.getElementById('playerCount');
  const progressBarEl = document.getElementById('progressBar');
  const timeDisplayEl = document.getElementById('timeDisplay');
  const audioEl = document.getElementById('audio');

  // method 显式指定：GET 不传 body，POST 传对象
  const api = (path, { method = 'GET', body } = {}) => fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());

  // ================= 播放模式切换 =================
  function syncModeUI() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  async function setMode(newMode) {
    if (newMode === mode) return;
    mode = newMode;
    localStorage.setItem('le_mode', newMode);
    syncModeUI();
    await api('/api/stop', { method: 'POST' }); // 切换 → 停止旧播放
    updatePlayerUI(null);
  }

  document.getElementById('modeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });

  // ================= 循环模式 =================
  function syncPlayModeUI() {
    document.querySelectorAll('.mode2-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.playmode === playMode);
    });
  }

  async function setPlayMode(newMode) {
    playMode = newMode;
    localStorage.setItem('le_playMode', newMode);
    syncPlayModeUI();
    await api('/api/playMode', { method: 'POST', body: { playMode: newMode } });
  }

  document.querySelector('.player__modes').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode2-btn');
    if (btn) setPlayMode(btn.dataset.playmode);
  });

  // ================= 播放控制 =================
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // 更新播放器 UI（status 为 null 时隐藏）
  function updatePlayerUI(status) {
    if (!status || status.state === 'idle' || !status.currentFile) {
      playerEl.hidden = true;
      return;
    }
    playerEl.hidden = false;
    const name = status.currentFile.split('/').pop();
    playerNameEl.textContent = name;
    playerCountEl.textContent = `${status.currentIndex + 1}/${status.queueLength}`;

    const isPlaying = status.state === 'playing';
    playerIconEl.textContent = isPlaying ? '▶' : '⏸';
    document.getElementById('btnPause').textContent = isPlaying ? '⏸' : '▶';

    // 进度（browser 模式用 audio 自身时间，server 模式用轮询到的 elapsed）
    if (mode === 'browser' && audioEl.duration) {
      const cur = audioEl.currentTime;
      progressBarEl.value = (cur / audioEl.duration) * 100;
      timeDisplayEl.textContent = `${formatTime(cur)} / ${formatTime(audioEl.duration)}`;
    } else if (status.elapsed != null) {
      progressBarEl.value = Math.min(status.elapsed * 100, 100); // 无时长，按秒走
      timeDisplayEl.textContent = `${formatTime(status.elapsed)} / ${formatTime(status.elapsed)}`;
    }
  }

  // ================= 播放 =================
  async function playTarget(relPath) {
    const res = await api('/api/play', { method: 'POST', body: { path: relPath, mode, playMode } });
    if (res.error) { console.error('播放失败:', res.error); return; }
    updatePlayerUI(res);

    if (mode === 'browser' && res.url) {
      audioEl.src = res.url;
      audioEl.play();
    }
  }

  // ================= 文件树渲染 =================
  function renderTree(node) {
    const ul = document.createElement('ul');
    ul.className = 'tree';

    for (const child of node.children) {
      const li = document.createElement('li');

      if (child.type === 'directory') {
        li.className = 'tree-item tree-item--dir';

        const label = document.createElement('div');
        label.className = 'dir-label';
        label.textContent = `📁 ${child.name}/`;

        // 目录播放按钮
        const playBtn = document.createElement('button');
        playBtn.className = 'dir-play';
        playBtn.title = `播放 ${child.name} 全部`;
        playBtn.textContent = '▶';
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 不触发折叠
          playTarget(child.path);
        });

        const nested = renderTree(child);
        nested.hidden = true;

        label.addEventListener('click', () => {
          nested.hidden = !nested.hidden;
        });

        const dirHeader = document.createElement('div');
        dirHeader.className = 'dir-header';
        dirHeader.append(label, playBtn);

        li.append(dirHeader, nested);
      } else {
        li.className = 'tree-item tree-item--file';
        li.textContent = `🎵 ${child.name}`;
        li.addEventListener('click', () => playTarget(child.path));
      }

      ul.append(li);
    }

    return ul;
  }

  function showLoading(message) {
    fileTreeEl.replaceChildren();
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
      fileTreeEl.append(renderTree(tree));
    } catch (err) {
      showLoading(`加载失败: ${err.message}`);
    }
  }

  // ================= 浏览器模式 <audio> 事件 =================
  audioEl.addEventListener('timeupdate', () => {
    if (mode === 'browser' && audioEl.duration) {
      progressBarEl.value = (audioEl.currentTime / audioEl.duration) * 100;
      timeDisplayEl.textContent = `${formatTime(audioEl.currentTime)} / ${formatTime(audioEl.duration)}`;
    }
  });

  // 播完自动下一首
  audioEl.addEventListener('ended', async () => {
    const res = await api('/api/next', { method: 'POST' });
    if (res.url) {
      audioEl.src = res.url;
      audioEl.play();
      updatePlayerUI(res);
    } else {
      updatePlayerUI(null); // 队列播完
    }
  });

  // ================= 控制按钮 =================
  document.getElementById('btnPause').addEventListener('click', async () => {
    if (mode === 'browser') {
      // 浏览器：直接控制 audio
      if (audioEl.paused) audioEl.play(); else audioEl.pause();
    } else {
      const res = await api('/api/pause', { method: 'POST' });
      updatePlayerUI(res);
    }
  });

  document.getElementById('btnNext').addEventListener('click', async () => {
    const res = await api('/api/next', { method: 'POST' });
    if (mode === 'browser' && res.url) {
      // 正常：拿到下一首 url
      audioEl.src = res.url;
      audioEl.play();
    } else if (mode === 'browser' && res.state !== 'idle' && res.currentFile) {
      // 兜底：服务端 outputMode 与前端不同步时，重新拉取当前文件流
      const p = await api('/api/play', { method: 'POST', body: { path: res.currentFile, mode, playMode } });
      if (p.url) { audioEl.src = p.url; audioEl.play(); }
    }
    updatePlayerUI(res);
  });

  document.getElementById('btnPrev').addEventListener('click', async () => {
    // 简单实现：回到上一首（M2 简化，跳回队列前一个）
    const s = await api('/api/status');
    if (s.currentIndex > 0) {
      const res = await api('/api/play', { method: 'POST', body: { path: s.currentFile, mode, playMode } });
      updatePlayerUI(res);
    }
  });

  document.getElementById('btnStop').addEventListener('click', async () => {
    await api('/api/stop', { method: 'POST' });
    audioEl.pause();
    audioEl.removeAttribute('src');
    updatePlayerUI(null);
  });

  // 进度条拖动（浏览器模式）
  progressBarEl.addEventListener('input', () => {
    if (mode === 'browser' && audioEl.duration) {
      audioEl.currentTime = (progressBarEl.value / 100) * audioEl.duration;
    }
  });

  // ================= 音箱模式轮询 =================
  setInterval(async () => {
    if (mode === 'server') {
      const status = await api('/api/status'); // GET，不传 body
      updatePlayerUI(status);
    }
  }, 2000);

  // ================= 轻量提示 toast =================
  let toastTimer = null;
  function toast(message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.append(el);
    }
    el.textContent = message;
    el.classList.add('toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('toast--show'), 2500);
  }

  // ================= 刷新文件树 =================
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    const btn = document.getElementById('btnRefresh');
    btn.classList.add('spin');
    try {
      const res = await api('/api/refresh', { method: 'POST' });
      await loadTree();
      toast(`已刷新，共 ${res.fileCount} 个音频`);
    } catch (e) {
      toast('刷新失败');
    }
    setTimeout(() => btn.classList.remove('spin'), 600);
  });

  // ================= 退出登录 =================
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      location.href = '/logout';
    });
  }

  // ================= 初始化 =================
  syncModeUI();
  syncPlayModeUI();
  loadTree();
})();

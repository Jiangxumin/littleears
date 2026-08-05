/**
 * app.js — 前端交互逻辑（M2）
 *
 * 功能：
 *  - 文件浏览：进入/返回式导航（点击目录进入，← 返回 回上层，
 *    最深层目录的音频列表即播放列表；目录行带 ▶ 播放全部）
 *  - 播放模式切换：音箱 / 浏览器（切换自动停止）
 *  - 循环模式：单曲 🔂 / 顺序 🔁 / 随机 🔀
 *  - 播放控制：暂停/恢复、上一首、下一首、停止、进度条
 *  - 浏览器模式：<audio> 播放，ended 自动下一首
 *  - 音箱模式：轮询 /api/status 同步状态
 */
(() => {
  'use strict';

  let mode = localStorage.getItem('le_mode') || 'server'; // 默认音箱
  let playMode = localStorage.getItem('le_playMode') || 'shuffle'; // 默认随机

  const fileTreeEl = document.getElementById('fileTree');
  const playerEl = document.getElementById('player');
  const playerIconEl = document.getElementById('playerIcon');
  const playerNameEl = document.getElementById('playerName');
  const playerCountEl = document.getElementById('playerCount');
  const progressBarEl = document.getElementById('progressBar');
  const timeDisplayEl = document.getElementById('timeDisplay');
  const audioEl = document.getElementById('audio');
  const volumeBarEl = document.getElementById('volumeBar');
  const volumeSliderEl = document.getElementById('volumeSlider');
  const volumeValueEl = document.getElementById('volumeValue');
  const sleepHoursEl = document.getElementById('sleepHours');
  const sleepMinsEl = document.getElementById('sleepMins');
  const sleepCountdownEl = document.getElementById('sleepCountdown');
  const btnSleepStart = document.getElementById('btnSleepStart');
  const btnSleepCancel = document.getElementById('btnSleepCancel');

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
    syncVolumeUI(); // 音量条只对音箱模式有意义
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

  // ================= 定时暂停 =================
  let lastSleepFireSeq = null; // null = 尚未从后端初始化

  // 由 status 刷新倒计时 + 按到点事件同步浏览器暂停
  function syncSleep(status) {
    if (!status) return;
    if (lastSleepFireSeq === null) lastSleepFireSeq = status.sleepFireSeq; // 首次仅初始化
    if (status.sleepRemaining == null) {
      sleepCountdownEl.hidden = true;
      btnSleepCancel.hidden = true;
      lastSleepFireSeq = status.sleepFireSeq; // 无活动定时：对齐基线（后端重启恢复）
      return;
    }
    sleepCountdownEl.hidden = false;
    btnSleepCancel.hidden = false;
    sleepCountdownEl.textContent = `⏲ 剩余 ${formatTime(status.sleepRemaining)}`;
    // 到点事件：序号递增 → 浏览器暂停一次（音箱模式后端已直接暂停）
    if (status.sleepFireSeq > lastSleepFireSeq) {
      lastSleepFireSeq = status.sleepFireSeq;
      if (mode === 'browser') audioEl.pause();
    }
  }

  async function startSleep() {
    const minutes = Number(sleepHoursEl.value) * 60 + Number(sleepMinsEl.value);
    const res = await api('/api/sleep', { method: 'POST', body: { minutes } });
    if (res && res.sleepFireSeq != null) lastSleepFireSeq = res.sleepFireSeq; // 启动即对齐
    syncSleep(res);
  }

  btnSleepStart.addEventListener('click', startSleep);
  btnSleepCancel.addEventListener('click', async () => {
    const res = await api('/api/sleep', { method: 'POST', body: { minutes: 0 } });
    syncSleep(res);
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
    lastStatus = status || null; // 供文件浏览高亮正在播放的行
    if (!status || status.state === 'idle' || !status.currentFile) {
      playerEl.hidden = true;
      highlightPlaying();
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

    highlightPlaying(); // 切歌后高亮跟着走

    // 同步音量条（status 带 volume；无则保持现值）
    if (typeof status.volume === 'number') {
      volumeSliderEl.value = status.volume;
      volumeValueEl.textContent = status.volume;
    }
  }

  // ================= 音量（仅音箱模式） =================
  function syncVolumeUI() {
    volumeBarEl.hidden = mode !== 'server';
  }

  // 拖动滑条：实时调服务端音量（当前曲以新音量重启）
  volumeSliderEl.addEventListener('input', async () => {
    const v = Number(volumeSliderEl.value);
    volumeValueEl.textContent = v;
    const res = await api('/api/volume', { method: 'POST', body: { volume: v } });
    if (res && typeof res.volume === 'number') volumeValueEl.textContent = res.volume;
  });

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

  // ================= 文件浏览：进入/返回式导航 =================
  // 点击目录进入下级，← 返回 回上层；最深层目录的音频列表即播放列表
  const navStack = [];    // 已进入的目录节点（祖先链，不含当前）
  let currentNode = null; // 当前显示的目录节点
  let lastStatus = null;  // 最近一次播放状态（用于高亮正在播放的行）

  function renderCurrentDir() {
    const node = currentNode;
    fileTreeEl.replaceChildren();

    // 顶部导航栏：← 返回 + 面包屑（点击可跳回任意上级）
    const bar = document.createElement('div');
    bar.className = 'browser-bar';

    if (navStack.length > 0) {
      const backBtn = document.createElement('button');
      backBtn.className = 'back-btn';
      backBtn.textContent = '← 返回';
      backBtn.addEventListener('click', goBack);
      bar.append(backBtn);
    }

    const crumbs = [...navStack, node];
    const trail = document.createElement('div');
    trail.className = 'crumbs';
    crumbs.forEach((n, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        trail.append(sep);
      }
      const crumb = document.createElement('button');
      crumb.className = 'crumb' + (i === crumbs.length - 1 ? ' crumb--current' : '');
      crumb.textContent = i === 0 ? '全部音频' : n.name;
      if (i < crumbs.length - 1) crumb.addEventListener('click', () => jumpTo(i));
      trail.append(crumb);
    });
    bar.append(trail);
    fileTreeEl.append(bar);

    const dirs = node.children.filter(c => c.type === 'directory');
    const files = node.children.filter(c => c.type === 'file');
    const isLeaf = dirs.length === 0; // 最深层：音频列表即播放列表

    if (dirs.length + files.length === 0) {
      const p = document.createElement('p');
      p.className = 'loading';
      p.textContent = '暂无音频，点右上角 🔄 重新扫描';
      fileTreeEl.append(p);
      return;
    }

    // 目录行：点击整行进入，右侧 ▶ 播放该目录全部音频
    if (dirs.length > 0) {
      const h = document.createElement('h2');
      h.className = 'browser-section';
      h.textContent = `📁 目录（${dirs.length}）`;
      fileTreeEl.append(h);

      const ul = document.createElement('ul');
      ul.className = 'browse';
      for (const d of dirs) {
        const li = document.createElement('li');
        li.className = 'browse-row browse-row--dir';

        const label = document.createElement('span');
        label.className = 'row-label';
        label.textContent = `📁 ${d.name}`;
        li.append(label);

        const playBtn = document.createElement('button');
        playBtn.className = 'row-play';
        playBtn.title = `播放 ${d.name} 全部音频`;
        playBtn.textContent = '▶';
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 只播放，不进入
          playTarget(d.path);
        });
        li.append(playBtn);

        li.addEventListener('click', () => enterDir(d));
        ul.append(li);
      }
      fileTreeEl.append(ul);
    }

    // 音频行：点击播放；叶子目录时即播放列表
    if (files.length > 0) {
      const h = document.createElement('h2');
      h.className = 'browser-section';
      h.textContent = isLeaf ? `🎵 播放列表（${files.length}）` : `🎵 音频（${files.length}）`;
      fileTreeEl.append(h);

      const ul = document.createElement('ul');
      ul.className = 'browse';
      for (const f of files) {
        const li = document.createElement('li');
        li.className = 'browse-row browse-row--file';
        li.dataset.path = f.path; // 供「正在播放」高亮定位

        const label = document.createElement('span');
        label.className = 'row-label';
        label.textContent = `🎵 ${f.name}`;
        li.append(label);

        li.addEventListener('click', () => playTarget(f.path));
        ul.append(li);
      }
      fileTreeEl.append(ul);
    }

    highlightPlaying();
  }

  /** 进入下一级目录 */
  function enterDir(dirNode) {
    navStack.push(currentNode);
    currentNode = dirNode;
    renderCurrentDir();
  }

  /** ← 返回：回到上一层 */
  function goBack() {
    if (!navStack.length) return;
    currentNode = navStack.pop();
    renderCurrentDir();
  }

  /** 面包屑跳转到第 level 级（0 = 根目录） */
  function jumpTo(level) {
    currentNode = navStack[level];
    navStack.length = level;
    renderCurrentDir();
  }

  /** 高亮当前正在播放的音频行 */
  function highlightPlaying() {
    fileTreeEl.querySelectorAll('.browse-row--playing')
      .forEach(el => el.classList.remove('browse-row--playing'));
    if (!lastStatus || !lastStatus.currentFile) return;
    const row = fileTreeEl.querySelector(
      `.browse-row--file[data-path="${CSS.escape(lastStatus.currentFile)}"]`);
    if (row) row.classList.add('browse-row--playing');
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
      navStack.length = 0; // 刷新后回到根目录
      currentNode = tree;
      renderCurrentDir();
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

  // 播完自动下一首（auto:true = 自动推进，受定时兜底约束）
  audioEl.addEventListener('ended', async () => {
    const res = await api('/api/next', { method: 'POST', body: { auto: true } });
    if (res.url) {
      audioEl.src = res.url;
      audioEl.play();
      updatePlayerUI(res);
    } else {
      updatePlayerUI(null); // 队列播完（或定时命中）→ 收起播放器
    }
  });

  // 浏览器模式：<audio> 播放/暂停时同步播放器图标（手动暂停、定时到点暂停都走这里）
  audioEl.addEventListener('play', () => {
    if (playerEl.hidden) return;
    playerIconEl.textContent = '▶';
    document.getElementById('btnPause').textContent = '⏸';
  });
  audioEl.addEventListener('pause', () => {
    if (playerEl.hidden) return;
    playerIconEl.textContent = '⏸';
    document.getElementById('btnPause').textContent = '▶';
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

  // ================= 音箱模式轮询 + 定时同步（两模式都跑） =================
  setInterval(async () => {
    const status = await api('/api/status');
    syncSleep(status);
    if (mode === 'server') updatePlayerUI(status);
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
  syncVolumeUI();
  loadTree();
})();

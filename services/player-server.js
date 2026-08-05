/**
 * player-server.js — 音箱播放器
 *
 * 职责：通过 child_process 调用系统音频工具（mpg123 / ffplay），
 * 让音频从树莓派的有线音箱输出。
 *
 * 为什么用子进程而不是 Node 库？
 *  - mpg123 / ffplay 是成熟、轻量的命令行播放器，树莓派上 apt 直接安装
 *  - Node 只管「起进程、听退出、发信号」，职责清晰，学习成本低
 *
 * 回退策略：mpg123 缺失时（未安装）自动改用 ffplay，ffplay 支持全部格式。
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let proc = null; // 当前播放子进程
let playGen = 0; // 播放代际号：解决快速连点时的异步竞态
let volume = loadVolume(); // 当前音箱音量（0-100）
let currentEnd = null; // 当前曲「自然播完」回调：调音量重启当前曲时复用，避免丢失自动下一首

/** 从持久化文件加载音量；无文件/损坏时用默认值 */
function loadVolume() {
  try {
    const v = JSON.parse(fs.readFileSync(config.volume.file, 'utf8')).volume;
    if (typeof v === 'number' && v >= config.volume.min && v <= config.volume.max) return v;
  } catch (e) { /* 文件不存在或损坏 → 用默认 */ }
  return config.volume.default;
}

/** 保存音量到持久化文件（静默失败，不因磁盘问题影响播放） */
function saveVolume(v) {
  try {
    fs.mkdirSync(path.dirname(config.volume.file), { recursive: true });
    fs.writeFileSync(config.volume.file, JSON.stringify({ volume: v }));
  } catch (e) {
    console.error(`⚠️ 音量持久化失败: ${e.message}`);
  }
}

/**
 * 平台相关音量控制：
 *  - arm/arm64（树莓派板载 3.5mm，无混音器）→ 应用内 --scale/-volume（调音量需重启当前曲）
 *  - x86 等有 PulseAudio 的桌面 → pactl 系统音量（即时生效，不重启进程）
 */
const PLATFORM_VOLUME_PACTL = ['x64', 'x32', 'ia32'];

function isPactlVolume() {
  return PLATFORM_VOLUME_PACTL.includes(process.arch);
}

/** 通过 pactl 设置默认 sink 音量（0-100），即时生效 */
function setPactlVolume(vol) {
  try {
    execFileSync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${vol}%`]);
    return true;
  } catch (e) {
    console.error(`⚠️ pactl 设置音量失败: ${e.message}`);
    return false;
  }
}

/**
 * 音量 → 播放工具参数：
 *  - pactl 平台（x86）：固定 100% 原始响度（音量由 pactl 系统音量独占控制，避免双重放大）
 *  - 非 pactl 平台（树莓派）：mpg123 --scale n (32768=100%) / ffplay -volume 0-100
 */
function volumeArgs(isMp3, vol) {
  if (isPactlVolume()) {
    return isMp3 ? ['--scale', '32768'] : ['-volume', '100'];
  }
  if (isMp3) return ['--scale', String(Math.round((vol / 100) * 32768))];
  return ['-volume', String(vol)];
}

/**
 * 清理残留的播放进程。
 * 服务重启后，旧服务的子进程会变成孤儿继续播放（声音残留）。
 * 模块加载时执行一次，确保新服务接管所有播放。
 * 用 execFileSync 直接调 pkill（不经 shell，无注入风险）。
 */
function cleanupOrphans() {
  try {
    execFileSync('pkill', ['-f', '^(mpg123|ffplay)']);
    console.log('🧹 已清理残留播放进程');
  } catch (e) {
    /* 没有进程可杀时 pkill 返回非零，忽略 */
  }
}
cleanupOrphans();

/** 根据文件后缀选择首选播放工具 */
function pickPlayer(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isMp3 = ext === '.mp3';
  const cmd = isMp3 ? config.player.mp3 : config.player.other;
  return { command: cmd.command, args: [...cmd.args, filePath] };
}

/**
 * 按平台注入声卡参数：
 *  - 树莓派 arm/arm64 → 直连耳机声卡（-a hw:CARD=Headphones）
 *  - x86 等其他平台 → 无追加参数，用系统默认声卡（桌面经 PulseAudio 路由）
 */
function platformCardArgs(arch, isMp3) {
  const cards = config.platform[arch];
  if (!cards) return [];
  return isMp3 ? cards.mp3 : cards.other;
}

/**
 * 组装播放参数 = 工具默认参数 + 平台声卡参数 + 音量参数 + 文件路径
 * 例（树莓派 mp3）: mpg123 -q -a hw:CARD=Headphones --scale 26214 file.mp3
 * 例（x86 mp3）   : mpg123 -q --scale 26214 file.mp3
 */
function buildArgs(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isMp3 = ext === '.mp3';
  const cmd = isMp3 ? config.player.mp3 : config.player.other;
  return { command: cmd.command, args: [...cmd.args, ...platformCardArgs(process.arch, isMp3), ...volumeArgs(isMp3, volume), filePath] };
}

/** 启动子进程；若命令不存在则回退到 ffplay */
function spawnWithFallback(spec, onEnd) {
  const trySpawn = (command, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => resolve(child));
    });

  return trySpawn(spec.command, spec.args)
    .catch(() => {
      // 首选工具缺失（如 mpg123 未安装），回退 ffplay
      // 回退同样按平台注入声卡参数
      const fb = config.player.other;
      const fbCard = platformCardArgs(process.arch, false);
      return trySpawn(fb.command, [...fb.args, ...fbCard, spec.args[spec.args.length - 1]]);
    })
    .catch(() => null); // 两个都失败
}

/**
 * 开始播放
 * @param {string} filePath 文件绝对路径
 * @param {Function} onEnd 播放自然结束时的回调
 */
async function play(filePath, onEnd) {
  // 代际令牌：本次播放的唯一编号。快速连点时，只有最新的一次会被采纳
  const gen = ++playGen;
  currentEnd = onEnd; // 记住本次注册的结束回调，供 setVolume 重启当前曲时复用
  killCurrent(); // 停掉上一个（轻量，不用 pkill 以免误伤并发中的新进程）

  console.log(`🔊 音箱播放: ${filePath}`);
  const spec = buildArgs(filePath);
  const newProc = await spawnWithFallback(spec, onEnd);

  // 竞态检查：等待期间若又有新的 play() 调用，本次结果作废
  if (gen !== playGen) {
    if (newProc) newProc.kill('SIGTERM'); // 迟到的进程，立即杀掉
    return;
  }
  proc = newProc;
  if (proc) proc.filePath = filePath; // 记录文件：音量调节时以此重启

  if (!proc) {
    console.error(`❌ 播放工具启动失败，请安装: sudo apt install mpg123 ffmpeg`);
    return;
  }

  proc.on('error', (err) => {
    console.error(`❌ 播放进程错误: ${err.message}`);
    proc = null;
  });

  proc.on('exit', (code, signal) => {
    // 代际校验：旧进程的 exit 事件（被 killCurrent 杀掉的）不应触发任何逻辑
    if (gen !== playGen) return;
    proc = null;
    // 只有「自然退出」（非我们主动 kill）才视为播放结束
    // mpg123 收到 SIGTERM 可能优雅退出(signal=null,code=0)，必须用代际号兜底
    const stoppedByUs = signal === 'SIGTERM' || signal === 'SIGKILL';
    if (!stoppedByUs && onEnd) onEnd();
  });
}

/** 停止播放（模式切换 / 主动停止时调用） */
function stop() {
  // 代际号前进：让所有「等待中的播放」作废
  playGen++;
  killCurrent();
  currentEnd = null; // 清空结束回调，避免 stop 后残留
  // 兜底强杀：SIGKILL 不可被捕获，即使有漏网的 mpg123/ffplay 也必死
  // （进程消失时 exit 事件的 signal 为 SIGKILL，已计入 stoppedByUs，不会误触发 onEnd）
  try {
    execFileSync('pkill', ['-9', '-f', '^(mpg123|ffplay)']);
  } catch (e) {
    /* 没有进程可杀时 pkill 返回非零，忽略 */
  }
}

/** 只杀当前引用的进程（内部用，play 切换时调用，不触发 pkill 全杀） */
function killCurrent() {
  if (proc) {
    proc.kill('SIGTERM');
    proc = null;
    console.log('⏹ 音箱停止');
  }
}

/**
 * 暂停播放：SIGSTOP 挂起进程（不终止，进度保留）
 * mpg123/ffplay 不支持命令内暂停，但 POSIX 信号可挂起任何进程
 */
function pause() {
  if (proc) {
    proc.kill('SIGSTOP');
    console.log('⏸ 音箱暂停');
  }
}

/** 恢复播放：SIGCONT 继续被挂起的进程 */
function resume() {
  if (proc) {
    proc.kill('SIGCONT');
    console.log('▶ 音箱恢复');
  }
}

/** 当前是否有播放进程 */
function isPlaying() {
  return proc !== null;
}

/** 当前音量（0-100） */
function getVolume() {
  return volume;
}

/**
 * 设置音箱音量：
 *  - pactl 平台（x86）：pactl 系统音量即时生效，不打断播放
 *  - 非 pactl 平台（树莓派）：应用内 --scale，调音量需重启当前曲（1 秒级）
 * 均持久化（重启服务不丢）
 */
function setVolume(v) {
  volume = Math.max(config.volume.min, Math.min(config.volume.max, Math.round(v)));
  saveVolume(volume);

  if (isPactlVolume()) {
    setPactlVolume(volume); // 即时生效，不重启
  } else if (proc) {
    // 正在播放：以新音量重启当前曲，复用已注册的结束回调，保证重启后仍能自动下一首
    play(proc.filePath, currentEnd);
  }
  return volume;
}

module.exports = { play, stop, pause, resume, isPlaying, getVolume, setVolume };

// x86：启动时把系统 sink 音量同步到持久化值，避免残留系统音量影响播放
// （放模块末尾：此时 PLATFORM_VOLUME_PACTL/setPactlVolume 已定义）
if (isPactlVolume()) setPactlVolume(volume);

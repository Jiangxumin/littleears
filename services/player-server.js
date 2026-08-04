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
const config = require('../config');

let proc = null; // 当前播放子进程

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
      const fb = config.player.other;
      return trySpawn(fb.command, [...fb.args, spec.args[spec.args.length - 1]]);
    })
    .catch(() => null); // 两个都失败
}

/**
 * 开始播放
 * @param {string} filePath 文件绝对路径
 * @param {Function} onEnd 播放自然结束时的回调
 */
async function play(filePath, onEnd) {
  stop(); // 先停掉上一个

  console.log(`🔊 音箱播放: ${filePath}`);
  const spec = pickPlayer(filePath);
  proc = await spawnWithFallback(spec, onEnd);

  if (!proc) {
    console.error(`❌ 播放工具启动失败，请安装: sudo apt install mpg123 ffmpeg`);
    return;
  }

  proc.on('error', (err) => {
    console.error(`❌ 播放进程错误: ${err.message}`);
    proc = null;
  });

  proc.on('exit', (code, signal) => {
    proc = null;
    // 只有「自然退出」（非我们主动 kill）才视为播放结束
    const stoppedByUs = signal === 'SIGTERM' || signal === 'SIGKILL';
    if (!stoppedByUs && onEnd) onEnd();
  });
}

/** 停止播放 */
function stop() {
  if (proc) {
    proc.kill('SIGTERM');
    proc = null;
    console.log('⏹ 音箱停止');
  }
  currentFile = null;
}

/** 当前是否有播放进程 */
function isPlaying() {
  return proc !== null;
}

module.exports = { play, stop, isPlaying };

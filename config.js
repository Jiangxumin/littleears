/**
 * LittleEars 配置文件
 *
 * 所有可调参数集中在这里，方便部署到树莓派时修改。
 */
const path = require('path');

module.exports = {
  // 服务端口（花生壳端口映射时需与此一致）
  port: process.env.PORT || 3000,

  // 音频文件根目录（实际使用中可改为外接硬盘路径，如 /mnt/usb/media）
  mediaRoot: path.join(__dirname, 'media'),

  // 支持的音频文件后缀
  audioExtensions: ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'],

  // 访问密码（M3 启用认证；空字符串 = 不启用）
  password: process.env.LITTLEEARS_PASSWORD || '',

  // 音箱播放工具：mpg123 负责 MP3，ffplay 负责其他格式
  // 注意：-a hw:CARD=Headphones 直连耳机声卡，绕开 PulseAudio——
  // systemd 服务环境没有 XDG_RUNTIME_DIR，连不上 PulseAudio 会退回
  // 默认声卡（card0=HDMI，未接显示器）导致无声。按卡名指定不受卡号变动影响。
  player: {
    mp3: { command: 'mpg123', args: ['-q', '-a', 'hw:CARD=Headphones'] },
    other: { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] },
  },
};

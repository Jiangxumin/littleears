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
  // 声卡参数按平台区分（见下方 platform.cards）：
  //  - 树莓派 arm：-a hw:CARD=Headphones 直连耳机声卡，绕开 PulseAudio——
  //    systemd 服务环境没有 XDG_RUNTIME_DIR，连不上 PulseAudio 会退回
  //    默认声卡（card0=HDMI，未接显示器）导致无声。按卡名指定不受卡号变动影响。
  //  - x86：不传 -a，走系统默认声卡（桌面默认经 PulseAudio/PipeWire 路由）
  player: {
    mp3: { command: 'mpg123', args: ['-q'] },
    other: { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] },
  },

  // 按平台指定音箱声卡参数（运行时追加到 player 参数的 -a 之后）
  // 键为 process.arch 的值：arm 系（树莓派）直连耳机声卡，其余用系统默认
  platform: {
    // 树莓派：32 位系统 arch=arm，64 位系统 arch=arm64
    arm:    { mp3: ['-a', 'hw:CARD=Headphones'], other: ['-audio_device', 'hw:CARD=Headphones'] },
    arm64:  { mp3: ['-a', 'hw:CARD=Headphones'], other: ['-audio_device', 'hw:CARD=Headphones'] },
    // x86 / x64 等：用系统默认声卡（桌面环境经 PulseAudio 路由）
  },
};

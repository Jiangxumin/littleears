# 🎧 LittleEars

英语启蒙「磨耳朵」音频播放系统 — 运行在树莓派（或任何 Linux 设备）上，通过 Web 界面控制播放。

- 🎵 廖彩杏书单 / SSS / 英文故事 / 中文故事，按目录分类存放
- 🔊 两种播放模式：**音箱播放**（树莓派有线音箱）/ **浏览器播放**（当前设备出声）
- 📱 手机、电脑、平板浏览器均可访问，局域网内零配置
- 🌐 配合花生壳 + 端口映射可远程访问

## 目录结构

```
littleears/
├── server.js              # 入口文件
├── config.js              # 配置（端口、音频目录、密码）
├── services/
│   ├── scanner.js         # 文件扫描 → 文件树 JSON
│   ├── player-server.js   # 音箱播放（mpg123 / ffplay）
│   ├── player-browser.js  # 浏览器播放（音频流）
│   └── player-manager.js  # 播放管理器（M2 开发中）
├── routes/api.js          # API 路由
├── views/                 # EJS 页面模板
├── public/                # 前端静态资源（CSS/JS）
└── media/                 # 音频文件（按目录分类）
    ├── 廖彩杏/
    │   └── 1阶段/          # 62 首，命名 1-a_书名.mp3 ...
    ├── SSS/
    ├── 英文故事/
    └── 中文故事/
```

## 快速启动

### 1. 安装依赖

```bash
cd littleears
npm install
```

### 2. 安装音频播放工具（树莓派 / Ubuntu 相同）

```bash
sudo apt install mpg123 ffmpeg
```

### 3. 启动

```bash
npm start
```

**设置访问密码**（公网/远程访问时强烈建议）：

```bash
# 方式一：环境变量（推荐，不写入代码）
LITTLEEARS_PASSWORD=你的密码 npm start

# 方式二：修改 config.js 中的 password 字段
```

- 不设密码 → 局域网免密访问（适合纯内网）
- 设了密码 → 首次访问需登录，保护公网访问

看到以下输出即成功：

```
🎧 LittleEars 已启动: http://0.0.0.0:3000
  音频目录: /home/promote/edu_ws/littleears/media
```

### 4. 访问

- **局域网**：手机/电脑浏览器打开 `http://<树莓派IP>:3000`
  （查 IP：`hostname -I`）
- **本机**：`http://localhost:3000`

## 使用

1. 点击文件树目录展开 → 点击音频文件播放
2. 顶栏切换播放模式：
   - **🔊 音箱** — 声音从树莓派音箱输出（切模式自动停止旧播放）
   - **📱 浏览器** — 声音从当前设备输出
3. 新增音频：拷贝到 `media/` 对应目录，重启服务（或后续版本点「刷新」）即可看到

## 添加音频

音频按目录存放，**目录即分类，文件名即播放顺序**：

```
media/廖彩杏/
├── 1阶段/
│   ├── 1-a_Ape in a cape.mp3
│   ├── 2-a_Brown bear.mp3
│   └── ...
└── 2阶段/          ← 新增：建目录放进去即可
```

- 文件名建议 `序号-子序号_名称.mp3`（如 `1-a_...`、`2-b_...`），按数值自然排序
- 支持格式：`.mp3` `.wav` `.m4a` `.mp4` `.flac` `.ogg`

## 远程访问（花生壳 + 端口映射）

通过花生壳域名 + 路由器端口映射，在外网也能控制播放。

```
互联网 → 花生壳域名(xxx.vicp.net:3000) → 路由器端口映射 → 树莓派内网IP:3000
```

**配置步骤：**

1. **路由器端口映射**：登录路由器 → 端口映射/虚拟服务器
   - 外部端口：`3000`
   - 内部 IP：树莓派内网地址（如 `192.168.1.100`，`hostname -I` 查看）
   - 内部端口：`3000`
   - 协议：TCP

2. **花生壳**：注册花生壳账号 → 添加映射 → 绑定域名（如 `xxx.vicp.net`）→ 指向上述端口

3. **设置访问密码**（公网必须）：`LITTLEEARS_PASSWORD=你的密码` 启动

4. 外网访问 `http://xxx.vicp.net:3000`，输入密码即可控制

> 树莓派内网 IP 建议在路由器里绑定 MAC 地址固定，避免重启后 IP 变化。

## 部署到树莓派（开机自启）

用 **systemd** 让服务开机自动运行、崩溃自动重启。

1. 创建服务文件 `/etc/systemd/system/littleears.service`：

```ini
[Unit]
Description=LittleEars Audio Player
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/littleears
Environment=LITTLEEARS_PASSWORD=你的密码
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> `User`、`WorkingDirectory`、`node` 路径按实际修改（`which node` 查看 node 路径）。

2. 启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable littleears   # 开机自启
sudo systemctl start littleears    # 立即启动
sudo systemctl status littleears   # 查看状态
journalctl -u littleears -f        # 查看实时日志
```

## API 一览

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/` | 主页面（未登录重定向 /login） |
| `GET/POST` | `/login` `/logout` | 登录 / 退出（配置密码后生效） |
| `GET` | `/api/files` | 音频文件树 JSON |
| `POST` | `/api/refresh` | 重新扫描文件目录 |
| `POST` | `/api/play` | 播放 `{ path, mode, playMode }`（path 可为文件或目录） |
| `POST` | `/api/next` | 下一首（同目录内） |
| `POST` | `/api/pause` | 暂停 / 恢复 |
| `POST` | `/api/stop` | 停止 |
| `POST` | `/api/playMode` | 循环模式 `{ playMode: "single"\|"sequential"\|"shuffle" }` |
| `GET` | `/api/status` | 当前播放状态 |
| `GET` | `/media/*` | 音频文件流（受认证保护） |

## 开发

```bash
npm run dev    # 开发模式（文件变更自动重启）
```

## 技术栈

- **后端**：Node.js + Express + EJS
- **播放**：mpg123（MP3）/ ffplay（回退），child_process 子进程
- **前端**：原生 HTML/CSS/JS，无框架

## 里程碑

> 唯一的进度记录源（更新于 2026-08-04）

- [x] **M1 — Hello Ears**（2026-08-04）：文件树 + 双模式播放 + 路径安全
- [x] **M2 — 完整播放体验**（2026-08-04）：循环模式 🔂🔁🔀、暂停/进度、目录播放、下一首不跨目录
- [x] **M3 — 远程 + 体验**（2026-08-04）：密码认证、文件刷新、移动端适配、花生壳远程、开机自启
- [ ] **M4 — 锦上添花**：定时停止、历史、收藏

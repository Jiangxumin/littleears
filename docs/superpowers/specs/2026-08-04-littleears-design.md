# LittleEars — 英语启蒙音频播放系统

## Context

为孩子设计一个「磨耳朵」音频播放系统，运行在树莓派上，支持有线音箱输出，通过 Web 界面远程控制播放。音频内容按目录分类存放（廖彩杏书单、SSS、英文故事、中文故事等），支持两种播放模式（树莓派音箱 / 浏览器播放），局域网为主、花生壳域名 + 端口映射实现远程访问。

---

## 技术选型

| 层 | 技术 | 选型理由 |
|---|---|---|
| 后端框架 | **Express.js** | Node.js 最经典框架，轻量，学习曲线平缓 |
| 模板引擎 | **EJS** | 接近原生 HTML，学习成本低 |
| 前端 | **原生 JS + CSS** | 极简设计，不引入框架 |
| 音箱播放 | **mpg123**（MP3）/ **ffplay**（MP4） | 轻量稳定，通过 child_process 调用 |
| 浏览器播放 | **HTML5 `<audio>` + Express 静态文件/流** | 零依赖，原生支持 |
| 远程访问 | **花生壳域名 + 路由器端口映射** | 国内家庭网络主流方案 |

---

## 架构

```
手机/电脑浏览器 (http://树莓派IP:3000)
        │
        ▼
Express 服务 (server.js)
  ├── routes/api.js          — API 路由
  ├── services/scanner.js    — 递归扫描 media/ 目录
  ├── services/player-manager.js — 播放调度、循环模式、状态管理
  ├── services/player-server.js  — child_process 调用 mpg123/ffplay
  ├── services/player-browser.js — 文件流 → 前端 <audio>
  ├── views/index.ejs         — 主页面模板
  └── public/css & js         — 静态资源
        │
        ▼
media/  (音频文件目录，支持 mp3/wav/m4a/mp4/flac/ogg)
  ├── 廖彩杏/
  ├── SSS/
  ├── 英文故事/
  └── 中文故事/
```

### 关键设计原则

- **文件即数据库**：目录结构 = 数据模型，新增音频只需拷贝文件，无需配置
- **事件驱动播放**：播放结束事件 → 根据循环模式决定下一首
- **状态机模型**：IDLE → PLAYING → PAUSED / NEXT_TRACK → PLAYING / IDLE
- **单一进程**：全局最多一个音频子进程，通过队列避免并发播放

---

## API 设计

| 方法 | 路径 | 功能 | M 版本 |
|------|------|------|--------|
| `GET` | `/` | 主页面 | M1 |
| `GET` | `/api/files` | 获取音频文件树 JSON | M1 |
| `POST` | `/api/play` | 播放 `{ filePath, mode }` (mode: server/browser) | M1 |
| `POST` | `/api/stop` | 停止播放 | M2 |
| `POST` | `/api/pause` | 暂停 / 恢复 | M2 |
| `GET` | `/api/status` | 当前播放状态（文件名、进度、mode、playMode） | M2 |
| `POST` | `/api/playMode` | 切换循环模式 `{ playMode: "single" \| "sequential" \| "shuffle" }` | M2 |
| `POST` | `/api/refresh` | 重新扫描文件目录 | M3 |

---

## 页面结构

```
┌─────────────────────────────────────────┐
│  🎧 LittleEars                          │
├──────────────┬──────────────────────────┤
│  播放模式切换  │  循环模式                 │
│  ○音箱 ○浏览器 │  🔂单曲  🔁顺序  🔀随机   │
├──────────────┴──────────────────────────┤
│  播放状态                                │
│  正在播放: The Wheels on the Bus.mp3     │
│  ▮▮▮▮▮░░░░ 1:23 / 4:56   [⏸暂停] [⏹停止] │
├─────────────────────────────────────────┤
│  音频文件树（可折叠目录）                   │
│  📁 廖彩杏/              [▶ 播放全部]     │
│    📁 Week1/                             │
│      🎵 The Wheels on the Bus.mp3        │
│      🎵 Brown Bear.mp3                   │
│  📁 SSS/                                │
│  📁 英文故事/                            │
│  📁 中文故事/                            │
└─────────────────────────────────────────┘
```

---

## 项目目录结构

```
littleears/
├── server.js              # Express 入口
├── package.json
├── config.js              # 音频根目录路径、端口、密码
├── services/
│   ├── scanner.js         # 递归扫描目录 → JSON 树
│   ├── player-server.js   # child_process 调用 mpg123/ffplay
│   ├── player-browser.js  # 文件流处理
│   └── player-manager.js  # 播放调度 + 循环模式 + 状态机
├── routes/
│   └── api.js             # API 路由处理
├── middleware/
│   └── auth.js            # 简单密码认证（M3）
├── views/
│   ├── index.ejs          # 主页面模板
│   └── partials/
│       └── header.ejs     # 公共头部
├── public/
│   ├── css/
│   │   └── style.css      # 样式
│   └── js/
│       └── app.js         # 前端交互
└── media/                  # 音频文件（与代码分离，config.js 中配置路径）
```

---

## 核心模块设计

### player-manager.js — 播放管理器（核心）

```
状态机: IDLE → PLAYING → (曲目结束) → 判断 playMode
                                          ├── "single"     → 重播同一首
                                          ├── "sequential" → 下一首（末尾停止）
                                          └── "shuffle"    → 随机下一首
                                          
外部接口:
  setFile(filePath)  — 设置当前播放文件
  play(mode)         — 开始播放 (server/browser)
  pause()            — 暂停
  stop()             — 停止
  setPlayMode(mode)  — 切换循环模式
  getStatus()        — 获取当前状态对象
  next()             — 手动下一首
```

### scanner.js — 文件扫描

- 递归读取 media 目录，过滤支持的后缀
- 返回嵌套 JSON 树结构
- 首次扫描后缓存，`/api/refresh` 刷新
- 支持的后缀：`.mp3` `.wav` `.m4a` `.mp4` `.flac` `.ogg`

### player-server.js — 音箱播放

- `child_process.spawn('mpg123', [filePath])` 播放 MP3
- `child_process.spawn('ffplay', ['-nodisp', '-autoexit', filePath])` 回退方案
- 监听子进程 `exit` 事件通知 player-manager 播放结束
- 进程 kill 实现 stop / pause

### player-browser.js — 浏览器播放

- Express 静态文件中间件 + Range 请求支持
- 前端 `<audio>` 标签监听 `ended` / `timeupdate` 事件
- 前端通过 EventSource 或轮询 `/api/status` 同步状态

---

## 里程碑

### M1 — Hello Ears（最小可用）

| # | 任务 | 产出 |
|---|------|------|
| 1 | 初始化项目（package.json, Express, EJS） | 项目骨架 |
| 2 | 实现 scanner.js | 目录扫描 API |
| 3 | 实现 player-server.js | 音箱播放 |
| 4 | 实现 player-browser.js | 浏览器播放流 |
| 5 | 实现 index.ejs + app.js | 基础页面 |
| 6 | 实现播放模式切换（音箱/浏览器） | 双模式可用 |

**交付标准**：打开页面 → 看到文件树 → 点歌 → 音箱/浏览器出声

### M2 — 完整播放体验

| # | 任务 | 产出 |
|---|------|------|
| 1 | 实现 player-manager.js（状态机） | 播放调度核心 |
| 2 | 实现三种循环模式（单曲/顺序/随机） | 循环控制 |
| 3 | 实现暂停/停止/进度条 | 播放控制 |
| 4 | 实现目录级播放 | 点击目录播放全部 |
| 5 | 前端 LocalStorage 记住用户偏好 | 设置持久化 |

**交付标准**：完整播放体验，孩子能自主磨耳朵

### M3 — 远程 + 体验

| # | 任务 | 产出 |
|---|------|------|
| 1 | 简单密码认证中间件 | 公网安全 |
| 2 | 花生壳 + 端口映射文档 | 远程访问指南 |
| 3 | 移动端适配 CSS | 手机体验好 |
| 4 | 文件刷新按钮 + 前端通知 | 内容管理 |
| 5 | UI 美化（图标、配色、动画） | 视觉打磨 |

**交付标准**：外出也能远程控制，手机端体验良好

### M4 — 锦上添花（未来）

- 定时停止（哄睡模式）
- 播放历史记录
- 收藏夹
- M3U 播放列表导入

---

## 树莓派环境准备

需要在树莓派上安装的依赖：
```bash
# 音频播放工具
sudo apt install mpg123 ffmpeg

# Node.js (通过 nvm 或 apt)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2（进程守护，可选）
npm install -g pm2
```

---

## 远程访问配置（M3）

```
互联网 → 花生壳域名(xxx.vicp.net:3000) → 路由器端口映射 → 树莓派内网IP:3000
```

路由器设置：端口映射/虚拟服务器 → 外部端口 3000 → 内部 IP 树莓派地址 → 内部端口 3000

---

## 验证方式

| 阶段 | 验证项 |
|------|--------|
| M1 | `npm start` → 浏览器打开 localhost:3000 → 看到文件树 → 点击文件播放 |
| M2 | 切换循环模式 → 等待曲目结束自动切歌 → 暂停恢复正常 |
| M3 | 手机浏览器访问 → 界面适配 → 花生壳地址访问 → 密码认证生效 |

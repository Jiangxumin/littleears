#!/usr/bin/env bash
#
# LittleEars 服务一键安装脚本（systemd 开机自启）
#
# 用法（在树莓派上，项目目录内执行）：
#   cd /home/promote/edu_ws/littleears
#   bash scripts/install.sh                       # 不设密码（局域网免密）
#   LITTLEEARS_PASSWORD=你的密码 bash scripts/install.sh   # 设密码（公网需登录）
#
# 前提：脚本需要 sudo 权限（写入 /etc/systemd/system/）
#
set -euo pipefail

SERVICE_NAME="littleears"
# 项目根目录 = 脚本所在目录的上一级（脚本位于 scripts/）
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="$(whoami)"
NODE_BIN="$(command -v node || true)"

echo "=========================================="
echo "  🎧 LittleEars 服务安装"
echo "=========================================="
echo "项目目录 : $APP_DIR"
echo "运行用户 : $SERVICE_USER"
echo "Node 路径: $NODE_BIN"
echo

# ---------- 前置检查 ----------
if [ -z "$NODE_BIN" ]; then
  echo "❌ 未找到 node，请先安装 Node.js:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "   sudo apt install -y nodejs"
  exit 1
fi

echo "检查音频播放工具..."
for cmd in mpg123 ffmpeg; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  ✅ $cmd 已安装"
  else
    echo "  ⚠️  $cmd 未安装，建议执行: sudo apt install -y $cmd"
  fi
done
echo

# ---------- 安装 npm 依赖 ----------
if [ ! -d "$APP_DIR/node_modules" ]; then
  echo "📦 安装 npm 依赖..."
  (cd "$APP_DIR" && npm install)
  echo
fi

# ---------- 密码配置 ----------
PASSWORD="${LITTLEEARS_PASSWORD:-}"
if [ -n "$PASSWORD" ]; then
  echo "🔐 已设置访问密码（局域网免密，仅公网需登录）"
  ENV_LINE="Environment=LITTLEEARS_PASSWORD=${PASSWORD}"
else
  echo "🔓 未设置密码（所有人免密访问）"
  ENV_LINE="# Environment=LITTLEEARS_PASSWORD=your_password_here"
fi
echo

# ---------- 生成 service 文件 ----------
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
echo "📝 生成 systemd 服务: $SERVICE_FILE"
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=LittleEars Audio Player
Documentation=https://github.com/promote/littleears
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
${ENV_LINE}
ExecStart=${NODE_BIN} ${APP_DIR}/server.js
Restart=on-failure
RestartSec=5
# 日志输出到 journalctl
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# ---------- 启用并启动 ----------
echo "🚀 启用并启动服务..."
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

sleep 1.5
echo
echo "=========================================="
echo "  ✅ 安装完成"
echo "=========================================="
echo
echo "服务状态:"
sudo systemctl status "${SERVICE_NAME}" --no-pager -l | head -12 || true
echo

IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "📡 访问地址:"
echo "   局域网: http://${IP_ADDR:-<树莓派IP>}:3000"
echo
echo "🔧 常用命令:"
echo "   sudo systemctl status littleears     # 查看状态"
echo "   sudo systemctl restart littleears    # 重启"
echo "   sudo systemctl stop littleears       # 停止"
echo "   journalctl -u littleears -f          # 实时日志"
echo
echo "🗑️  卸载: bash scripts/uninstall.sh"

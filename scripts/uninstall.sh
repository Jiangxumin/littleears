#!/usr/bin/env bash
#
# LittleEars 服务卸载脚本
#
set -euo pipefail

SERVICE_NAME="littleears"

echo "🗑️  卸载 LittleEars 服务..."
sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
sudo systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true

echo "✅ LittleEars 服务已卸载"
echo "   （项目代码和音频文件未删除，仍在 $(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)）"

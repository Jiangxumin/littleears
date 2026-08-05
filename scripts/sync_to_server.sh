#!/usr/bin/env bash
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/../media"
# 服务器信息不写死在脚本里（用户名/域名入库即曝露）：
# 在 ~/.ssh/config 中定义 Host rpi-server（含 HostName/User/Port），
# 或临时用环境变量 LE_SERVER 覆盖，如：LE_SERVER=user@host ./sync_to_server.sh
HOST="${LE_SERVER:-rpi-server}"
# 远端目标路径：用 ${HOME} 推导（与远端用户名一致时有效），不硬编码用户名
BASE="${HOME}/edu_ws/littleears/media"
SSH_OPT='ssh'
# --delete: 镜像同步，删除远端本地没有的文件/目录（用于清理旧的嵌套目录 media/media 等）
# 已手动清理服务端嵌套目录，暂时注释掉 --delete
# RSYNC_OPTS=(-avz --progress --delete)
RSYNC_OPTS=(-avz --progress)

# 列出 media 下的子目录
mapfile -t dirs < <(find "$SRC" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)

echo "media 目录下的内容："
for i in "${!dirs[@]}"; do
  size=$(du -sh "$SRC/${dirs[$i]}" 2>/dev/null | cut -f1)
  printf '  %2d) %s  (%s)\n' $((i + 1)) "${dirs[$i]}" "$size"
done
printf '  %2d) 全部\n' $(( ${#dirs[@]} + 1 ))

read -rp "请选择要同步的目录编号: " n

if ! [[ "$n" =~ ^[0-9]+$ ]]; then
  echo "无效输入：$n" >&2
  exit 1
fi

if (( n == ${#dirs[@]} + 1 )); then
  echo "==> 同步全部内容（镜像，删除远端多余文件）..."
  rsync "${RSYNC_OPTS[@]}" -e "$SSH_OPT" "$SRC/" "$HOST:$BASE/"
elif (( n >= 1 && n <= ${#dirs[@]} )); then
  d="${dirs[$((n - 1))]}"
  echo "==> 同步目录: $d（镜像，删除远端该目录下多余文件）..."
  rsync "${RSYNC_OPTS[@]}" -e "$SSH_OPT" "$SRC/$d/" "$HOST:$BASE/$d/"
else
  echo "无效编号: $n" >&2
  exit 1
fi

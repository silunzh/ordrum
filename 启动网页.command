#!/bin/bash
set -u
cd -P "$(dirname "$0")" || exit 1
port="${ORDRUM_PORT:-8765}"
case "$port" in
  ''|*[!0-9]*) printf '端口必须是 1–65535 的整数。\n'; exit 1 ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  printf '端口必须是 1–65535 的整数。\n'
  exit 1
fi
node_bin="$(command -v node || true)"
if [ -z "$node_bin" ] && [ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  node_bin="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
launch_token=''
if [ -n "$node_bin" ]; then
  launch_token="$(date +%s)-$$-$RANDOM"
  ORDRUM_PORT="$port" "$node_bin" scripts/serve.cjs &
elif command -v python3 >/dev/null 2>&1; then
  printf '当前使用 Python 启动。若仍看到旧界面，请接受网页里的更新提示，或使用 Node.js 重新启动。\n'
  python3 -m http.server "$port" --bind 127.0.0.1 --directory public &
else
  printf '没有找到 Node.js 或 Python 3。请安装其中一个后重新打开。\n'
  read -r -p '按回车关闭。'
  exit 1
fi
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
trap 'exit 0' INT TERM
url="http://127.0.0.1:$port"
ready=0
for attempt in {1..50}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    printf '启动未成功。请检查上面的提示。\n'
    wait "$server_pid"
    exit 1
  fi
  if /usr/bin/curl --silent --fail "$url/" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ] || ! kill -0 "$server_pid" 2>/dev/null; then
  printf '网页没有及时启动，请重试或检查端口。\n'
  exit 1
fi
open_url="$url/"
if [ -n "$launch_token" ]; then
  open_url="$url/?launch=$launch_token"
fi
printf '\n网页已打开：%s\n网页内点击“连接线上账号”，登录同一账号并确认，即可同步本地与线上进度。\n保留此窗口即可继续使用；按 Control+C 停止。\n\n' "$open_url"
/usr/bin/open "$open_url"
wait "$server_pid"

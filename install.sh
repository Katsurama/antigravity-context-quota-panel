#!/usr/bin/env bash
set -euo pipefail

# Antigravity「上下文与额度」插件安装脚本
# 用法：
#   ./install.sh         # 复制安装到 ~/.gemini/config/plugins/context-quota-panel（推荐）
#   ./install.sh --link  # 使用软链接安装（适合本地修改开发）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${HOME}/.gemini/config/plugins/context-quota-panel"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装 Node.js 20 及以上版本。"
  exit 1
fi

echo "🔍 检查运行环境: Node.js $(node -v)"
mkdir -p "${HOME}/.gemini/config/plugins"

if [[ "${1:-}" == "--link" ]]; then
  rm -rf "${PLUGIN_DIR}"
  ln -s "${SCRIPT_DIR}" "${PLUGIN_DIR}"
  echo "🔗 已创建软链接: ${PLUGIN_DIR} -> ${SCRIPT_DIR}"
else
  rm -rf "${PLUGIN_DIR}"
  mkdir -p "${PLUGIN_DIR}/assets" "${PLUGIN_DIR}/sidecars/quota_meter"
  cp "${SCRIPT_DIR}/plugin.json" "${PLUGIN_DIR}/plugin.json"
  cp "${SCRIPT_DIR}/assets/logo.svg" "${PLUGIN_DIR}/assets/logo.svg"
  cp "${SCRIPT_DIR}/sidecars/quota_meter/sidecar.json" "${PLUGIN_DIR}/sidecars/quota_meter/sidecar.json"
  cp "${SCRIPT_DIR}/sidecars/quota_meter/main.mjs" "${PLUGIN_DIR}/sidecars/quota_meter/main.mjs"
  cp "${SCRIPT_DIR}/sidecars/quota_meter/index.html" "${PLUGIN_DIR}/sidecars/quota_meter/index.html"
  echo "📦 已复制插件文件至: ${PLUGIN_DIR}"
fi

# 若有旧进程正在运行，结束它以便下次打开时加载最新代码
pkill -f "quota_meter/main.mjs" >/dev/null 2>&1 || true

echo "✅ 安装完成！"
echo "👉 请在 Antigravity 左侧「Customizations / 插件管理」确认已启用「上下文与额度」，或直接在右侧辅助栏打开面板。"

#!/usr/bin/env bash
set -euo pipefail

# Antigravity「上下文与额度」插件卸载脚本
PLUGIN_DIR="${HOME}/.gemini/config/plugins/context-quota-panel"

pkill -f "quota_meter/main.mjs" >/dev/null 2>&1 || true

if [[ -e "${PLUGIN_DIR}" || -L "${PLUGIN_DIR}" ]]; then
  rm -rf "${PLUGIN_DIR}"
  echo "🗑️  已移除插件目录: ${PLUGIN_DIR}"
else
  echo "ℹ️  未发现已安装的插件目录: ${PLUGIN_DIR}"
fi

echo "✅ 卸载完成。"

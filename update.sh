#!/usr/bin/env bash
set -euo pipefail

# Antigravity「上下文与额度」插件一键更新脚本
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "⬇️  正在拉取仓库最新更新..."
git pull --ff-only

echo "🔄 正在重新安装插件并重载后端..."
bash "${SCRIPT_DIR}/install.sh" "$@"

echo "✅ 更新完成！如右侧面板正在打开，请点击右上角 ↻ 刷新即可。"

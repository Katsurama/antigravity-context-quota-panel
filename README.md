<div align="center">
  <img src="assets/logo.svg" width="88" height="88" alt="上下文与额度插件图标" />
  <h1>Antigravity 上下文与额度侧边栏插件</h1>
  <p>基于官方原生 Sidecar UI 机制的窄版中文监控面板 — 不修改 <code>app.asar</code>，客户端更新不失效</p>
</div>

---

## ✨ 功能特性

- **原生零侵入**：遵循 Antigravity 官方 `~/.gemini/config/plugins/` 插件与 Sidecar 规范开发，**不改写 `app.asar`、不依赖调试端口、`ElectronAsarIntegrity` 完全安全**。
- **自动跟随客户端主题**：通过官方 `/preload.js` 桥接实时读取宿主主题变量（`--background` / `--card` / `--foreground` 等），浅色 / 深色模式无缝自动切换。
- **按模型自动识别上下文上限**：
  - 自动匹配当前对话所用模型默认上限（`Gemini 4 / Orchestrator` 512K、`Gemini 3.8 Flash` 256K、`Claude` 200K、`GPT-OSS` 128K）。
  - 点击「上限」卡片支持**按当前模型独立自定义上限**（`128K` / `200K` / `256K` / `512K` / `1M` 或恢复自动）。
- **直观的 5 小时 & 周滚动额度看板**：
  - 自动识别当前对话窗口使用的模型组（如 `Gemini Models` / `Claude and GPT models`）。
  - 采用与上下文卡一致的大字百分比 + 进度条，并列对比 **5 小时额度** 与 **周额度**，自动标记 **`最紧`** 额度与中文重置倒计时。
- **实时监控增强**：
  - 下拉切换最近会话、近 20 次调用上下文增长曲线、生成速度（`tok/s`）与缓存命中率。
  - 上下文 ≥ 75% 时提供一键复制 `/compact`；右上角支持一键复制状态摘要、快捷键 `R` 刷新。
- **历史用量与月历热力图**：
  - 统计本机累计 / 今日 / 本月 / 年度 Token 消耗与 API 参考折算，支持点击设置自定义订阅月费计算回本倍数。
  - 展示 **Top 5 模型消耗排行**、输入/缓存/输出比例构成条及 4 色系可切换月历热力图。

---

## 📥 怎么导入 / 安装

### 方式一：终端一键克隆安装（推荐）

```bash
git clone https://github.com/<你的用户名>/antigravity-context-quota-panel.git
cd antigravity-context-quota-panel
chmod +x install.sh update.sh uninstall.sh
./install.sh
```

> 开发者调试模式可使用 `./install.sh --link` 创建软链接，修改仓库代码后无需重复拷贝。

### 方式二：手动导入安装

1. 点击右上角 **Download ZIP** 下载并解压本仓库。
2. 在本机创建插件目录 `~/.gemini/config/plugins/context-quota-panel/`。
3. 将仓库内的以下文件完整放入该目录中（保持目录结构不变）：
   ```text
   ~/.gemini/config/plugins/context-quota-panel/
   ├── plugin.json
   ├── assets/
   │   └── logo.svg
   └── sidecars/
       └── quota_meter/
           ├── sidecar.json
           ├── main.mjs
           └── index.html
   ```
4. 打开 Antigravity 左侧栏 **Customizations（插件管理）**，确认 **「上下文与额度」** 处于开启状态即可（无需重启客户端）。

---

## 🚀 怎么使用

1. **打开侧边栏面板**：
   - 在对话中点击助手提供的 `[上下文与额度]` 面板胶囊，或在右侧辅助栏（Aux Pane）切换到 **「上下文与额度」** 标签。
   - 拖动中间分隔线可自行调节侧边栏宽度（内容已按极窄布局适配）。
2. **「实时监控」页**：
   - 上方查看当前会话上下文占用；点击左上下拉框可切换最近会话；点击「上限」卡片可针对当前模型单独覆盖上下文上限。
   - 下方查看当前使用模型组的 **5 小时额度 / 周额度** 与 **最紧** 提醒；点击底部「其他模型组」可展开查看其余模型额度。
3. **「历史用量」页**：
   - 点击右上角 `本月 xx 回本` 胶囊可在行内填写或修改实际订阅月费（支持 USD / CNY）。
   - 点击月历方块查看当日明细，点击图例左侧圆点切换热力图色系。
4. **刷新与快捷操作**：
   - 右上角按钮支持 **复制当前状态摘要** 与 **立即刷新**（面板聚焦时按 **`R`** 键可快捷刷新）。
   - 点击底部状态栏可切换自动刷新间隔（`5秒` / `15秒` / `30秒` / `手动`）。

---

## 🔄 以后怎么更新

进入你当初克隆的仓库目录，执行一键更新脚本即可（会自动拉取最新代码、同步到插件目录并重启旧的 Sidecar 进程）：

```bash
cd antigravity-context-quota-panel
./update.sh
```

或者手动执行：

```bash
git pull --ff-only && ./install.sh
```

更新完成后，如果右侧面板正处于打开状态，点击面板右上角的 **`↻`** 刷新一下即可看到新版界面。

---

## 🗑️ 怎么卸载

运行卸载脚本（或直接删除 `~/.gemini/config/plugins/context-quota-panel` 目录）：

```bash
./uninstall.sh
```

---

## 📄 开源协议

[MIT License](LICENSE)

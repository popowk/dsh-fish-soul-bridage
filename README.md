# dsh-fish-soul-bridage v1.0.2

Windows 统一启动包，整合 DSH fish-soul 客户网关（56781）、SnowLuma WebUI/VMO 上报与 Ayu BreezeBlue TTS 桥（8765）。项目名 `bridage` 沿用仓库拼写。

## 运行方式

1. 解压到任意 Windows 目录（推荐 `C:\dsh\dsh-fish-soul-bridage`，**不要求固定路径**）。
2. 安装并首次启动 DSH Desktop，确保能访问已安装 fish-soul 插件；需要 PowerShell 5.1+、交互式桌面和可用的 Node 22.5+。
3. `Start.cmd` 是**唯一**启动入口，内部启动 Ayu → 检查 DSH 插件 → 启动 SnowLuma 监督器 → 启动 56781 网关。
4. 检查 `http://127.0.0.1:8765/health` 与 `http://127.0.0.1:56781/__bridge/health`，VMO 本机登记使用 127.0.0.1:18767 / Report-App-JSON.py 回退。
5. Ayu 在 fish-soul 设置 TTS Base URL 为 `http://127.0.0.1:8765/v1`，TTS 密钥填写个人的真实 BreezeBlue API Key，**不要提交到仓库**。

## 目录

```text
Start.cmd                       唯一启动文件
VERSION                         1.0.2 机器可读版本
scripts/Start-All.ps1           统一路径、进程和端口管理
components/gateway/             V6.9.29 原功能重构，客户操作、56781、VMO 上报
components/ayu/                 v1.4 Ayu TTS 桥；不保存 API 密钥
components/snowluma/            v2.4.2 用户提供的修复 Overlay（非完整原版 WebUI）
tests/                          集成结构和配置回归测试
```

## 关键兼容与限制

- 启动器会优先从 `C:\dsh\SnowLuma*` 中**同版本 2.4.2 的完整安装**复制缺失的公共 `client/` 静态资源到集成目录（不会覆盖修复后的 JS，也不会读取凭据和用户数据）。`SNOWLUMA_COMPLETE_SOURCE` 可显式指定补全来源，`SNOWLUMA_DIR` 则可直接指定完整安装目录并跳过复制。项目内用户提供的 `SnowLuma_v2.4.2_Fix.zip` 只有少量 JS/HTML 并缺少完整 CSS 资源，**不能冒充完整安装版**。启动器会验证存在 CSS，否则跳过 SnowLuma，防止从 VMO 打开后白屏。若需要应用补丁，应先备份完整原安装并按同版本覆盖 Overlay。
- SnowLuma 密码只在监督器直接启动并收到密码日志时捕获。观察已有进程不能恢复先前密码；56781 独立登录码仍单独上报，不等于 DSH Token。
- 防火墙检查通过后 SnowLuma 可监听 0.0.0.0，但仅允许受信源 `192.168.2.99`，公网走 VMO WSS；不要将 5099 直接开放公网。
- 8765、56781 与 18767 是不同端口；8765 仅监听回环，56781 使用自身登录码。
- 运行日志在 `%LOCALAPPDATA%\dsh-fish-soul-bridage\logs` 及兼容性网关日志目录。不会记录明文授权。
- SnowLuma 运行时包含第三方二进制与独立许可；本仓库不应未经许可公开分发这部分二进制。应通过授权的完整原版安装包配置 `SNOWLUMA_DIR`。
- 删除多个旧 `Start.bat`、`launcher.bat`、版本历史 README 和过时诊断脚本；保留正在被调用的网关模块与测试。

## 测试

`npm test` 或在系统 Node 22.5+ 下分别运行网关测试、Ayu smoke 测试。真实 DSH Desktop、VMO 转发与 Windows 防火墙必须在 Windows 实机验证。

## 故障诊断

- 56781 没监听：检查网关控制台与 `%LOCALAPPDATA%\DSH-FishSoul-Gateway\logs`。
- 8765 端口冲突：退出旧版单独 Ayu 实例或设置 `BRIDGE_PORT`（并同步 TTS BaseURL），统一入口不会强杀不相关进程。
- SnowLuma 网页缺 CSS：检查 `SNOWLUMA_DIR\client\assets\*.css`，不可只复制补丁并假装完整安装。
- VMO 502/404：分别检查本机服务健康、18767 注册与 8766 WSS 代理，单独验证上游。
## v1.0.1 — SnowLuma 2.4.2 反代修复

使用完整的 SnowLuma 2.4.2 安装目录，且其前端已经包含 VMO BasePath Overlay (`client/assets/*.vmo.js`)。
统一 `Start.cmd` 会先校验三个前端文件的 SHA-256，再修复 Logo、背景预览和调试文件上传的根路径问题。已修复文件会直接跳过；不认识的文件不会被强行覆盖。
原文件会备份到 `client/.vmo-backups/v1.0.1/`。如已经有完整 SnowLuma，可通过 `SNOWLUMA_DIR` 指向该目录，无需把第三方二进制提交到 GitHub。

手动只读预检：

```powershell
node scripts/Patch-SnowLuma-VMO.mjs "C:\dsh\SnowLuma" --check
```

停止 SnowLuma 后手动修复：

```powershell
node scripts/Patch-SnowLuma-VMO.mjs "C:\dsh\SnowLuma"
```

**发布说明：** 本仓库和 GitHub Release 只提供整合项目源码与可复现补丁器；SnowLuma v2.4.2 第三方运行文件不在公开仓库中。Windows/VMO 实机反向代理仍需单独验证。

## v1.0.2 — 已验证启动脚本

重新构建统一启动器，修正 v1.0.1 首次发布时的 PowerShell 文本替换错误。GitHub Actions Windows CI（Node 测试、补丁器语法、PowerShell 语法）通过后发布。SnowLuma 资源补丁仍保持 1.0.1 的 SHA-256 校验与备份路径。

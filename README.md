# dsh-fish-soul-bridage v1.1.4

Windows x64 整合项目：**DSH fish-soul 客户网关 + SnowLuma 2.4.2 + Ayu BreezeBlue TTS**。项目名 `bridage` 保留现有 GitHub 仓库拼写。

## 完整目录

```text
dsh-fish-soul-bridage/
├── Start.cmd                         唯一启动入口
├── VERSION                           整合项目版本
├── scripts/
│   ├── Start-All.ps1                 全路径相对定位及启动控制
│   └── Patch-SnowLuma-VMO.mjs        静态资源 SHA-256 校验及幂等修复
└── components/
    ├── gateway/                      fish-soul 客户网关、DSH 连接及 VMO 上报
    ├── ayu/                          Ayu TTS bridge
    └── snowluma/                     完整 SnowLuma v2.4.2 Windows 运行文件
        ├── node.exe
        ├── index.mjs
        ├── release.json
        ├── native/
        └── client/                   完整 CSS、JS、Logo 和 VMO BasePath 资源
```

**GitHub 仓库的 `components/snowluma/` 是完整运行目录**，并非过去只有部分 HTML/JS 的 Overlay；打包发布时直接使用 Git 中的文件，不再从第三方下载地址动态拼装。

## 运行

1. 先在 Windows 安装并初始化 **DSH Desktop**。本项目**不包含 DSH Desktop 安装程序**。
2. 在 DSH Desktop 中安装/启用 `dsh-fish-soul`；本项目**不包含 fish-soul 的 .tgz 离线安装包**。如果插件缺失，网关现有的 DSH CLI 安装流程可尝试从配置的软件源获取，需相应网络。
3. 下载 GitHub Release 的 **`Windows-Full.zip`**，解压到任意目录，运行根目录 `Start.cmd`。不要误用 GitHub 自动生成的源码压缩包。
4. SnowLuma 和 Ayu 使用项目附带的 `components/snowluma/node.exe`，不要求系统安装 Node；VMO Python 登记助手仍使用系统已安装的 Python。

应用端口：SnowLuma WebUI **5099**；fish-soul 客户网关 **56781**；Ayu TTS **8765**（仅本机）；已有 VMO Guest Agent **18767** 用于接收注册。VMO 管理页面 `https://host.tmd.pet/client` 通过已有隧道转发。

SnowLuma 的 VMO 反代版包括动态 CSS、Logo、背景预览及调试上传路径修复。启动前校验已知的文件 SHA-256，不识别的 SnowLuma 构建不会被静默覆盖；需要更新到新版 SnowLuma 时应先重新适配并验证。

## 发布方式

修改代码后，Windows CI 检查 JavaScript 和 PowerShell 语法；更新 `VERSION` 和 `package.json` 后，GitHub Actions 从**仓库中已提交的 SnowLuma 文件**构建完整 ZIP，并验证启动入口、Node、CSS、Logo、网关、Ayu 都存在。Release 不包含 DSH Desktop 的安装程序，也不包含 fish-soul 插件安装包。

不收集或提交本机 DSH Token、SnowLuma 随机密码、fish-soul 独立登录码或浏览器登录数据。更新时不要覆盖用户配置目录。Windows 实机启动及 VMO 端到端反代仍需另行验证。

## v1.1.3 — 兼容 dsh-fish-soul 0.15.55

- 新版抖音配置：支持 `masterUid`（19 位及以上 UID 保留字符串）、`shareCard` 和 `replyWindowMinutes`，继续拒绝未知命令字段和危险浏览器路径。
- 语音设置：支持 TTS MiniMax、STT MiniMax/DashScope，TTS 试听调用与超时策略保持原样。
- 表情包：兼容 `POST /stickers/import?name=...` 原始 PNG/JPEG/GIF/WebP（单张 20 MiB 上限）、旧版 JSON 请求、标签编辑；只在认证后读取已列入 native 工作区清单的图片。
- 运行日志：允许 `/diag-log` 查看和 `/diag-log/clear` 清空；抖音消息批量忽略入口已纳入明确白名单。
- **安全边界不变**：不提供任意命令执行、DSH Host RPC、任意网址读取或任意文件访问，所有 POST 要求已授权会话和同源校验。
- **不会自动升级 fish-soul 插件**：此版本调整的是网关兼容性；如要使用上游修复，请在 DSH Desktop 中安装或升级 `dsh-fish-soul@0.15.55`。已经工作的旧插件不会被安装器擅自替换。
- SnowLuma 2.4.2、Ayu、内置 Node 与 `Start.cmd` 保持不变；发布包仍不含 DSH Desktop 安装程序及 fish-soul 插件离线安装包。Windows 端到端运行需要使用真实 DSH 和 VMO 做最后验证。

## v1.1.4 — 适配 dsh-fish-soul 0.16.4

本次为网关兼容性更新，不会覆盖 SnowLuma、Ayu、DSH Desktop 及用户配置。GitHub Windows-Full ZIP 仍从仓库内完整的 `components/snowluma/` 生成，不含 DSH Desktop 安装程序或 fish-soul 插件安装包。

- 抖音身份确认：新增 `/douyin/uin-candidates`、`/douyin/uin-confirm`、`/douyin/uin-dismiss`，只允许受限的候选昵称和既有的抖音配置权限。
- 自身旧记忆：支持 `GET /inspector/self-outdated?offset=...`，仅允许 offset 0–1000000 的安全分页参数；补齐人物卡“立即整理” `POST /inspector/dream`。
- 表情包：支持 `POST /stickers/backfill`（给旧表情补标签和向量），限制工作区必须是后端已识别的本机路径，并限制单次数量；AI 补标签、人物整理共用低频额度及独立超时（默认 240 秒）。
- 保持 `/update/apply`、系统命令、任意文件访问、DSH 核心 RPC 等高权限接口关闭。跨账号会话上下文的修复由 **上游 fish-soul 0.16.4 插件自身**提供，不能仅靠网关升级实现。
- 原生 `client.diag.js` 等新分块由现有清单发现器按校验通过的插件资源动态加载，SnowLuma 反代和 Ayu 语音端口不变。

**升级要求：**请先确认 Windows 内的 DSH Desktop 已安装真实的 `dsh-fish-soul@0.16.4` 并重新启动该插件；本 ZIP 只升级整合网关，不会自动升级/附带 fish-soul 插件。涉及用户私聊、抖音身份或历史记忆操作之前，请备份 DSH 资料和数据库。GitHub Windows CI 已通过模拟接口与权限测试；未在真实 DSH + QQ + VMO 客户环境完成端到端验证。

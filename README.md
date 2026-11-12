# dsh-fish-soul-bridage v1.1.1

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

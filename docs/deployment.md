# 部署与配置

[返回首页](../README.md) · [网站接入](integration.md) · [API 文档](api.md) · [维护与升级](maintenance.md)

Open Kounter 提供三种部署方式，选择其中一种即可：

| 方式 | 操作入口 |
|---|---|
| [Git Clone + CLI](#git-clone--cli) | 将仓库克隆到本地，通过 EdgeOne CLI 登录、构建和部署 |
| [CNB Fork 后点击部署按钮](#cnb-按钮部署) | 在 CNB 上 Fork 仓库，在自己的仓库中填写 Token 与项目名并启动流水线 |
| [EdgeOne Makers 一键部署按钮](#edgeone-makers-按钮部署) | 点击部署按钮，在 Makers 控制台导入 GitHub 仓库并部署 |

三种方式部署后都需开启 [Blob 存储](#blob-存储)，再[初始化管理员 Token](#初始化与登录)。

仓库保留 EdgeOne Pages 的目录及 SDK 命名，平台界面也可能显示为 EdgeOne Makers。平台文档：[Cloud Functions](https://pages.edgeone.ai/document/cloud-functions) · [Blob 存储](https://pages.edgeone.ai/document/blob-storage)。

## Git Clone + CLI

本地准备 Git、Node.js 22 和 npm，无需先在 CNB 上 Fork：

```bash
git clone https://cnb.cool/Mintimate/tool-forge/open-kounter.git
cd open-kounter
npm ci
npm install -g edgeone@1.6.13
edgeone login
edgeone makers deploy -n open-kounter
```

`edgeone login` 会引导选择站点并在浏览器中登录自己的 Makers 账号。部署命令中的 `open-kounter` 是项目名，可以替换；项目不存在时自动创建，已有同名项目须为「直接上传」类型，并会更新其生产部署。

从仓库根目录执行部署命令，CLI 会按 [构建配置](#构建配置) 自动构建前端、Cloud Functions 和 Edge Functions，无需另行运行构建或单独上传 `dist`。部署完成后打开 CLI 返回的访问地址，保留完整查询参数。命令与登录说明见 [EdgeOne CLI 官方文档](https://pages.edgeone.ai/document/edgeone-cli)。

## CNB 按钮部署

> **前置步骤：在 CNB 平台上 Fork 本仓库。** 部署按钮位于你 Fork 后的 CNB 仓库中；仅在 GitHub 上 Fork 不会出现 CNB 的部署按钮。

1. 登录 CNB，打开 [Open Kounter 的 CNB 仓库](https://cnb.cool/Mintimate/tool-forge/open-kounter)，点击 **Fork**，创建自己的 CNB 仓库副本。
2. 进入**自己 Fork 后的 CNB 仓库**，打开「代码」→ `main` 分支页面，找到并点击 **部署到 EdgeOne Makers**。触发按钮需要该仓库的写权限。
3. 填写自己的 **EdgeOne Makers Token**（在 Makers 控制台的 [API Token](https://pages.edgeone.ai/document/api-token) 页面创建）和 **EdgeOne Makers 项目名**；项目名默认 `open-kounter`，可修改。
4. 确认后，CNB 使用 Node.js 22 安装依赖及固定版本的 EdgeOne CLI，从仓库根目录构建并部署到**生产环境**。项目不存在时自动创建；已有同名项目会更新部署，且须为支持 CLI 部署的「直接上传」类型。
5. 等待流水线完成，从部署日志最后的 JSON 结果中打开 `url`，保留完整查询参数。首次部署后继续[开启 Blob](#blob-存储)并[初始化](#初始化与登录)。

按钮定义在 [`.cnb/web_trigger.yml`](../.cnb/web_trigger.yml)，对应 [`.cnb.yml`](../.cnb.yml) 的 `main.web_trigger_deploy_makers` 事件。此流程不依赖维护者的密钥仓库，与 `push` 自动同步及部署流程独立。CLI 自动执行 `edgeone.json` 的 `npm run build:makers`，同时构建前端、Cloud Functions 和 Edge Functions，无需手动上传 `dist`。

**Token 输入说明**：CNB 的按钮表单只有普通文本输入，没有密码框；请仅在自己信任的仓库填写 Token，不要分享含 Token 的表单、构建参数或截图。公开仓库的构建日志可能公开可见。部署脚本从环境变量读取 Token，不将它拼入命令行参数，并过滤 CLI 输出中的 Token；这不代表 CNB 的输入参数会被平台作为密钥保存。此 Token 用于 Makers 部署，与 Open Kounter 的管理员 Token 不同。平台规则见 [CNB 按钮触发器](https://docs.cnb.cool/zh/build/web-trigger.html)、[CNB 角色权限](https://docs.cnb.cool/zh/guide/role-permissions.html) 和 [EdgeOne CLI](https://pages.edgeone.ai/document/edgeone-cli)。

## EdgeOne Makers 按钮部署

点击一键部署按钮，在 EdgeOne Makers 控制台按提示导入仓库并创建项目：

[![使用 EdgeOne Makers 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https://github.com/Mintimate/open-kounter)

该入口使用 [GitHub 镜像](https://github.com/Mintimate/open-kounter)，建议先在 GitHub 上 Fork，并在控制台确认导入地址为自己的 Fork。检查下方构建配置后开始部署；无需使用 CNB 的 Fork 或按钮流程。项目主仓库仍位于 [CNB](https://cnb.cool/Mintimate/tool-forge/open-kounter)。

## 构建配置

| 配置项 | 值 |
|---|---|
| 框架预设 | Vite（`framework: "vite"`） |
| Makers 构建命令 | `npm run build:makers` |
| 输出目录 | `dist`（配置字段为 `outputDirectory`） |
| Node 版本 | `22` |

配置以 [`edgeone.json`](../edgeone.json) 为准。`npm run build` 仅用于本地前端构建；Makers 部署须使用 `npm run build:makers`，在前端构建后生成 `.edgeone/routes.json`，保留函数路由、静态资源优先匹配和 SPA fallback，并注册[原生定时清理](maintenance.md#原生定时清理)。该私有文件不在 `dist/` 内。

manifest 生成器适配本仓库的静态 JavaScript 函数入口和 SPA。新增动态函数路由、其它函数运行时、框架默认导出、Middleware、Agents 或额外的 `headers` / `redirects` / `rewrites` 时，须同步扩展生成器；遇到这些不支持的配置会明确中止构建，避免静默丢失路由配置。

## Blob 存储

Blob 是必需的主存储：

1. 在 EdgeOne Pages 控制台进入「项目设置 → 存储」，确认项目已开通 Blob 能力。
2. 首次访问时，Cloud Functions 自动创建并使用 `open-kounter` Store；如需自定义名称，设置 `OPEN_KOUNTER_BLOB_STORE`。
3. 启用 Blob 或调整环境变量后，建议重新部署项目。

存储选型和并发限制见[维护与升级](maintenance.md#为什么从-kv-切换到-blob)。

## 旧版 KV 迁移

仅在有旧版数据时，额外绑定旧 KV 命名空间，变量名保持为 `OPEN_KOUNTER`。随后在登录页或后台「数据备份」面板点击「旧 KV 迁移到 Blob」。新部署且没有历史数据时，无需绑定 KV。

## 初始化与登录

部署完成后访问项目网址：未预设 `ADMIN_TOKEN` 时，按页面提示创建管理员 Token；已预设时，使用该 Token 登录。Token 登录成功后，可在后台绑定 Passkey 或 OIDC。

| 登录方式 | 何时显示 | 使用方式 |
|---|---|---|
| Token | 始终可用 | 使用管理员 Token，也用于首次初始化和找回访问权限 |
| Passkey | 后台绑定后 | 使用已绑定的 Passkey 登录 |
| OIDC | 配置环境变量并绑定身份后 | 跳转到 OIDC Provider 登录 |

### Passkey 配置

Passkey 默认使用服务端 `request.url` 的 Origin 和 hostname，不信任请求的 `Origin` / `Referer` 头。平台内部转发地址与公开域名不同时，需设置 `PASSKEY_ORIGIN=https://你的公开域名`。如需固定 RP ID 或跨环境统一配置，设置 `PASSKEY_RP_ID`；显示名称通过 `PASSKEY_RP_NAME` 自定义。

### OIDC 配置

1. 在 EdgeOne Pages 环境变量中配置 `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET` 和 `OIDC_REDIRECT_URI`。
2. 在 OIDC Provider 中配置回调地址：`https://你的域名/api/oidc/callback`。
3. 使用管理员 Token 登录后台，在 OIDC 登录模块中点击「绑定 OIDC 身份」。
4. 绑定成功后退出登录，登录页会出现「使用 OIDC 登录」按钮。

OIDC 绑定身份保存在 Blob 的 `system/state.json` 中；临时 `state` 和一次性 Session 写入 `oidc/states/*.json` 与 `oidc/sessions/*.json`，通过 `expiresAt` 做应用层过期控制。Provider 要求和接口约定见 [OIDC 接口](api.md#oidc-接口)。

### 检测与重试

登录页并发检测初始化、旧 KV 和 Passkey 状态，加载占位至少显示 600ms，检测请求最多等待 5 秒。可选能力检测失败时隐藏对应入口，Token 登录仍可使用；未绑定旧 KV 属于正常未开启。初始化状态未知或检测失败时提供重试，并按 Token 登录处理；仅明确检测到未初始化时才允许初始化。

登录网络请求超时为 15 秒，支持卸载取消。已保存 Token 的校验遇到网络故障、服务器错误或无效响应时，保留本地 Token、保持未认证状态并提供重试；只有明确的认证失效响应才清除 Token。OIDC 一次性 Session 兑换不自动重试。

## 环境变量

| 变量名 | 必需 | 说明 |
|---|---|---|
| `OPEN_KOUNTER_BLOB_STORE` | 否 | 自定义 Blob Store 名称，默认 `open-kounter` |
| `OPEN_KOUNTER_CLEANUP_SECRET` | 启用定时清理时需要 | 至少 32 字符的随机密钥；构建与函数运行时保持一致。缺失时不注册定时任务，手动清理仍可用；轮换后需重新构建部署，禁止使用 `VITE_` 前缀或公开该值 |
| `OPEN_KOUNTER` | 否 | 旧 KV 命名空间绑定，仅在旧数据迁移期间需要；不是普通字符串变量 |
| `ADMIN_TOKEN` | 否 | 预设管理员 Token，优先级高于 Blob 中存储的 Token |
| `PASSKEY_RP_ID` | 否 | Passkey RP ID，默认使用当前域名 |
| `PASSKEY_ORIGIN` | 否 | 可信的公开 Origin，例如 `https://counter.example.com`；默认从服务端请求 URL 推导，内部转发域名不一致时必须配置 |
| `PASSKEY_RP_NAME` | 否 | Passkey 显示名称，默认 `Open Kounter` |
| `OIDC_ISSUER` | 否 | OIDC Issuer URL，例如 `https://auth.example.com/realms/master` |
| `OIDC_CLIENT_ID` | 否 | OIDC 客户端 ID |
| `OIDC_CLIENT_SECRET` | 否 | OIDC 客户端密钥，仅保存在环境变量中 |
| `OIDC_REDIRECT_URI` | 否 | OIDC 回调地址，例如 `https://your-domain.com/api/oidc/callback` |
| `EDGEONE_PAGES_API_TOKEN` | CNB 按钮部署时必需 | 用户在按钮表单填写的 Makers API Token，仅供部署 CLI 鉴权，不是管理员 Token；缺失或包含空白字符时在安装依赖前中止 |
| `EDGEONE_MAKERS_PROJECT_NAME` | 否（仅 CNB 部署） | Makers 目标项目名，表单默认 `open-kounter`；脚本对缺失或空白值同样回退该名称，非法名称中止部署 |

最后两项仅用于 CNB 构建环境，无需添加到 Makers 项目的运行时环境变量中。定时清理的密钥配置和轮换步骤见[原生定时清理](maintenance.md#原生定时清理)。

## 界面主题

登录页右上角和登录后的顶栏提供亮色、跟随系统、暗色三种模式，默认跟随操作系统并实时响应变化。选择保存在浏览器的 `open_kounter_theme` 中，仅用于界面偏好，不包含认证信息。

两种主题共享控件样式，仪表盘紧凑按钮与相邻输入框等高，输入框保留移动端可读字号；按钮、输入区域和背景网格均随主题调整。

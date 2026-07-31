# Open Kounter

Open Kounter 是一个基于 EdgeOne Pages Functions 和 Blob 存储的无服务器计数器服务，旨在替代 LeanCloud 为静态网站（如 Hexo）提供 PV/UV 统计功能。它包含一个完整的管理后台，支持数据管理、导入导出、域名白名单、旧版 KV 一键迁移、Passkey 无密码登录、OIDC 单点登录，以及亮色 / 跟随系统 / 暗色主题切换。

![Open Kounter Demo](./other/demoOfAdmin.webp)

更详细的介绍和部署指南请参考：
- [LeanCloud 遗憾谢幕：基于 EdgeOne Blob 打造高性能 PV/UV 访客统计](https://www.mintimate.cn/2026/02/14/openKounter/)

## 安装 AI Skill

本仓库提供 `migrate-to-open-kounter` Skill，可帮助 AI 检查网站中的 LeanCloud 计数逻辑，并自动适配到用户已经部署的 Open Kounter。

> 使用前必须先部署 Open Kounter，并向 AI 提供可访问的 HTTPS 服务域名。未部署或未提供域名时，Skill 会拒绝修改项目。
>
> 请在需要迁移的目标项目根目录执行安装命令。该 Skill 建议按项目安装，不建议使用 `-g` 全局安装。

### 中国大陆：推荐使用 CNB

```bash
npx skills add https://cnb.cool/Mintimate/tool-forge/open-kounter.git --skill migrate-to-open-kounter -y
```

### 非中国大陆：推荐使用 GitHub

```bash
npx skills add https://github.com/Mintimate/open-kounter.git --skill migrate-to-open-kounter -y
```

如需只安装到指定 Agent，可增加 `--agent` 参数，例如安装到 Codex：

```bash
npx skills add https://cnb.cool/Mintimate/tool-forge/open-kounter.git --skill migrate-to-open-kounter --agent codex -y
```

安装后可通过 `$migrate-to-open-kounter` 调用，例如：

```text
使用 $migrate-to-open-kounter，把当前项目的 LeanCloud 计数替换为 Open Kounter。
Open Kounter 服务地址：https://counter.example.com
```

## EdgeOne Pages 上部署

你可以通过 EdgeOne Pages 一键部署或手动配置构建：

一键部署：

[![使用 EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https://github.com/Mintimate/open-kounter)

> **注意**：点击上方按钮前，建议先 Fork 本仓库，并在跳转后的页面中确认仓库地址为你 Fork 后的地址。

手动部署配置：

- 框架预设：Node.js（或留空，EdgeOne 会识别 `edgeone.json`）
- 构建命令：`npm run build`
- 输出目录：`dist`
- Node 版本：`22`

更多 EdgeOne Pages文档：https://pages.edgeone.ai/zh/document/product-introduction

### 为什么从 KV 切换到 Blob

Open Kounter 早期使用 EdgeOne Pages KV 保存计数器、配置和认证信息，但 KV 的全球同步是最终一致模型，在多节点场景下会有明显同步延迟。

- 计数器刚写入后，后台列表或下一次读取可能短时间内看不到最新值。
- 域名白名单、Token、Passkey 相关状态在边缘节点之间同步时，也可能出现短暂不一致。
- 对于计数器这类“写完就要立刻读到最新结果”的场景，KV 的全球同步延迟会直接影响可用性。

现在主存储已经切换为 Blob，并在核心读取路径中使用强一致读取。这样做的目标很明确：解决 KV 全球同步存在延迟的问题，让计数、配置和认证状态在写入后能更快、更稳定地读到最新值。

### 配置 Blob 存储（必需）

本项目使用 Blob 作为主存储，部署后会在 cloud-functions 中自动创建并使用名为 `open-kounter` 的 Blob Store。

1. **开启 Blob 能力**
  - 在 EdgeOne Pages 控制台进入项目设置 > 存储
  - 确认项目已开通 Blob 能力

2. **首次访问自动创建 Store**
  - 默认会使用 `open-kounter` 作为 Blob Store 名称
  - 如需自定义名称，可设置环境变量 `OPEN_KOUNTER_BLOB_STORE`

3. **Passkey 域名配置（可选）**
  - Passkey 默认会使用当前页面 `Origin` 的 hostname 作为 RP ID
  - 如需固定 RP ID 或跨环境统一配置，可设置环境变量 `PASSKEY_RP_ID`
  - 如需自定义显示名称，可设置环境变量 `PASSKEY_RP_NAME`

4. **OIDC 单点登录配置（可选）**
  - 如需启用 OIDC 登录，请先在 EdgeOne Pages 环境变量中配置 OIDC 参数，并在 OIDC Provider 中把 Redirect URI 设置为 `https://你的域名/api/oidc/callback`
  - 配置完成后，管理员先使用 Token 登录后台，在 OIDC 登录模块中绑定身份；绑定成功后，登录页会自动显示 OIDC 登录按钮
  - 具体变量说明和使用流程见下方“环境变量一览”和“登录方式”章节

5. **重新部署项目**
  - 启用 Blob 或调整环境变量后建议重新部署

### 旧版 KV 迁移（可选）

如果你是从旧版 KV 存储迁移，请额外绑定旧 KV 命名空间，变量名仍为：`OPEN_KOUNTER`。

- 新部署且没有历史数据时，不需要绑定 KV。
- 已有旧 KV 数据时，可在登录页或后台“数据备份”面板中点击“旧 KV 迁移到 Blob”。

### 初始化

部署并配置完成后，访问你的项目网址，首次访问将引导你设置管理员 Token。


## 目录结构与文件说明

```tree
.
├── client/
│   └── adapter.js          # 客户端适配器，模拟 LeanCloud 行为
├── cloud-functions/        # 主后端逻辑 (Blob API)
│   └── api/
│       ├── auth.js         # 认证逻辑
│       ├── counter.js      # 计数器读写、列表与统计聚合
│       ├── init.js         # 初始化与迁移接口
│       ├── passkey.js      # Passkey 相关逻辑
│       └── oidc/           # OIDC 单点登录
│           ├── login.js    # OIDC 登录发起
│           ├── callback.js # OIDC 回调处理
│           └── status.js   # OIDC 绑定状态查询
├── edge-functions/         # 兼容旧版 KV 的迁移出口
│   └── legacy-api/
│       └── migrate.js      # 导出旧 KV 数据供 Blob 导入
├── src/                    # 前端管理后台 (Vue 3 + Vite)
│   ├── components/
│   │   ├── common/
│   │   │   ├── ConfirmModal.vue         # 通用确认弹窗
│   │   │   └── ThemeSwitcher.vue        # 三段式主题切换
│   │   ├── dashboard/
│   │   │   ├── AnalyticsOverview.vue    # 累计指标、热门页面与最近活跃
│   │   │   ├── CounterList.vue          # 计数器列表
│   │   │   ├── DataBackup.vue           # 数据备份与恢复
│   │   │   ├── DomainConfig.vue         # 域名白名单配置
│   │   │   ├── OidcManager.vue          # OIDC 绑定管理
│   │   │   ├── PasskeyManager.vue       # Passkey 管理
│   │   │   └── SingleCounterManager.vue # 单个计数器管理
│   │   ├── Dashboard.vue   # 仪表盘主组件
│   │   ├── Login.vue       # 登录组件
│   │   └── NotFound.vue    # 404 页面
│   ├── App.vue             # 主应用组件
│   ├── main.js             # 入口文件
│   ├── style.css           # 全局样式与主题 Token
│   └── theme.js            # 主题解析与持久化
├── edgeone.json            # EdgeOne 配置文件
├── index.html              # HTML 入口
├── package.json            # 项目依赖
├── tailwind.config.js      # Tailwind 配置
└── vite.config.js          # Vite 配置
```

## API 接口文档

所有 API 的基础路径为 `/api`。

### 公开接口 (无需认证)

#### 1. 获取计数
- **URL**: `GET /api/counter`
- **参数**: `target` (必填，计数器的 Key，如 `site-pv`)
- **响应**:
  ```json
  {
    "code": 0,
    "data": {
      "time": 100,
      "target": "site-pv",
      "created_at": 1700000000000,
      "updated_at": 1700000000000
    }
  }
  ```

#### 2. 增加计数 (自增)
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "inc",
    "target": "site-pv"
  }
  ```
- **说明**: 受域名白名单限制。

#### 3. 批量增加计数
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "batch_inc",
    "requests": [
      { "target": "site-pv" },
      { "target": "/posts/hello-world/" }
    ]
  }
  ```
- **说明**: 常用于同时更新站点总 PV 和单页 PV。受域名白名单限制。

### 管理接口 (需要认证)

需要在 Header 中携带 `Authorization: Bearer <YOUR_TOKEN>`。

#### 1. 设置计数器值
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "set",
    "target": "site-pv",
    "value": 1000
  }
  ```

#### 2. 删除计数器
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "delete",
    "target": "site-pv"
  }
  ```

#### 3. 获取计数器列表
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "list",
    "page": 1,
    "pageSize": 20,
    "query": "/posts/",
    "sortBy": "count",
    "sortOrder": "desc"
  }
  ```
- **可选参数**:
  - `query`: 按 Target Key 进行不区分大小写的包含匹配。
  - `sortBy`: `target` / `count` / `created_at` / `updated_at`，默认 `updated_at`。
  - `sortOrder`: `asc` / `desc`，默认 `desc`。
- **响应说明**: `total` 为筛选后的数量，`allTotal` 为全部计数器数量。

#### 4. 获取统计概览
- **URL**: `POST /api/counter`
- **Body**: `{ "action": "summary" }`
- **响应**:
  ```json
  {
    "code": 0,
    "data": {
      "sitePv": 12000,
      "siteUv": 3500,
      "totalCounters": 42,
      "pageCounters": 40,
      "staleCounters": 3,
      "zeroCounters": 1,
      "staleAfterDays": 30,
      "latestUpdatedAt": 1700000000000,
      "generatedAt": 1700000000000,
      "topPages": [],
      "recentlyActive": []
    }
  }
  ```
- **说明**: 直接聚合现有累计计数器，不新增 Blob Schema；热门页面与最近活跃均排除 `site-pv` 和 `site-uv`，各返回最多 8 条。

#### 5. 导出所有数据
- **URL**: `POST /api/counter`
- **Body**: `{ "action": "export_all" }`
- **响应**: 包含所有计数器数据和配置的 JSON 对象。

#### 6. 导入数据
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "import_all",
    "data": { ... } // 导出的 JSON 数据
  }
  ```

#### 7. 配置域名白名单
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "set_config",
    "allowedDomains": ["example.com", "*.example.com"]
  }
  ```

### OIDC 接口

OIDC 相关接口用于单点登录绑定、登录回调和状态管理。

#### 1. 发起 OIDC 授权
- **URL**: `GET /api/oidc/login?mode=login|bind`
- **说明**:
  - `mode=login`：发起 OIDC 登录。
  - `mode=bind&token=<ADMIN_TOKEN>`：管理员登录后绑定 OIDC 身份。
  - 后端会生成 `state` / `nonce`，写入 Blob 后重定向到 OIDC Provider 授权端点。

#### 2. OIDC 回调
- **URL**: `GET /api/oidc/callback?code=xxx&state=yyy`
- **说明**:
  - 由 OIDC Provider 回调。
  - `bind` 模式会验证管理员 Token 并把绑定身份写入 `system/state.json`。
  - `login` 模式会校验 `sub` 是否与已绑定身份一致，成功后生成一次性 OIDC Session。

#### 3. 查询 / 解绑 OIDC 状态
- **URL**: `POST /api/oidc/status`
- **Body**:
  ```json
  { "action": "get_status" }
  ```
- **说明**: 查询 OIDC 是否已配置、是否已绑定；解绑需携带 `Authorization: Bearer <YOUR_TOKEN>` 并传入 `{ "action": "unbind" }`。

#### 4. 使用 OIDC Session 换取管理 Token
- **URL**: `POST /api/auth`
- **Body**:
  ```json
  {
    "action": "oidc_verify",
    "oidcSession": "<session-id>"
  }
  ```
- **说明**: 前端在 OIDC 回调后自动调用；Session 是一次性的，验证后会被删除。

## 环境变量一览

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `OPEN_KOUNTER_BLOB_STORE` | 否 | 自定义 Blob Store 名称，默认 `open-kounter` |
| `ADMIN_TOKEN` | 否 | 预设管理员 Token（优先级高于 Blob 中存储的 Token） |
| `PASSKEY_RP_ID` | 否 | Passkey RP ID，默认使用当前域名 |
| `PASSKEY_RP_NAME` | 否 | Passkey 显示名称，默认 `Open Kounter` |
| `OIDC_ISSUER` | 否 | OIDC Issuer URL，例如 `https://auth.example.com/realms/master` |
| `OIDC_CLIENT_ID` | 否 | OIDC 客户端 ID |
| `OIDC_CLIENT_SECRET` | 否 | OIDC 客户端密钥，仅保存在环境变量中 |
| `OIDC_REDIRECT_URI` | 否 | OIDC 回调地址，例如 `https://your-domain.com/api/oidc/callback` |

## 界面主题

管理后台支持亮色、跟随系统和暗色三种模式，默认跟随操作系统。主题入口在登录页右上角和登录后的顶栏中：

1. **亮色**：固定使用亮色 Token。
2. **跟随系统**：监听操作系统主题变化并实时切换。
3. **暗色**：固定使用暗色 Token。

用户选择保存在浏览器的 `open_kounter_theme` 中；该值仅用于界面偏好，不包含认证信息。

亮色和暗色模式共享统一的控件语义：仪表盘短操作按钮采用紧凑尺寸，并与相邻输入框保持等高；输入框独立保留移动端可读字号，避免聚焦时页面缩放。主色、成功和警示按钮使用随主题 Token 变化且满足可读对比度的低饱和色块。亮色模式下输入框统一为白底描边，暗色模式保持更深的输入区域；页面背景使用主题自适应的低对比度网格，丰富层次但不干扰内容阅读。

## 登录方式

Open Kounter 支持三种登录方式，登录页会自动检测可用的登录方式并渐进式展示：

1. **Token 登录**（始终可用）：使用管理员 Token 直接登录，也用于首次初始化和找回访问权限。
2. **Passkey 登录**（按需展示）：在后台绑定 Passkey 后，登录页自动显示 Passkey 登录按钮。
3. **OIDC 登录**（按需展示）：配置 OIDC 环境变量并在后台绑定 OIDC 账号后，登录页自动显示 OIDC 登录按钮。

OIDC 的使用顺序建议如下：

1. 在 EdgeOne Pages 环境变量中配置 `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_REDIRECT_URI`。
2. 在 OIDC Provider 中配置回调地址：`https://你的域名/api/oidc/callback`。
3. 使用管理员 Token 登录 Open Kounter 后台。
4. 在后台的 OIDC 登录模块中点击“绑定 OIDC 身份”。
5. 绑定成功后退出登录，登录页会出现“使用 OIDC 登录”按钮。

OIDC 绑定身份会保存在 Blob 的 `system/state.json` 中；登录过程中的临时 `state` 和一次性 Session 会写入 `oidc/states/*.json` 与 `oidc/sessions/*.json`，并通过 `expiresAt` 做应用层过期控制。

> 登录页加载时会先进行环境检测（显示加载动画），检测完成后仅展示已配置/已绑定的登录方式，保持界面简洁。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

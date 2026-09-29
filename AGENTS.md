# AGENTS.md — Open Kounter Agent Operating Guide

> 本文件是 `open-kounter` 仓库唯一代码规范入口。目标：可执行、可验证、低歧义。
> 适用对象：在本仓库工作的 AI 代理与人类协作者。结合本仓库实际技术栈（Vue 3 + `<script setup>` + JavaScript + Tailwind v3 + EdgeOne Pages Functions + Blob）裁剪。

---

## 1) 指令优先级

冲突时：用户明确需求 → 安全稳定性 → 本规范 → 现有代码风格
无法消解时：不泄露敏感信息（Token / Passkey / OIDC Secret）、不引入破坏性变更（数据迁移、Blob Schema 变更）、不修改需求范围外逻辑。

---

## 2) 工作流

- **先理解再改动**：定位组件、数据流、Blob Key 与边界，不基于猜测修改
- **小步提交**：最小可行改动，每步可解释“为什么改、改了什么、如何验证”
- **变更后验证**：`npm run build` 必须通过、无新增警告
- **同步更新文档**：修改路由 / API 命名约定 / Blob Schema / 环境变量 / UI 公共类 / 规范本身时，必须同步更新本文件与 [README.md](README.md)
- **登录态在 `App.vue` 中通过 `isLoggedIn` + `<router-view>` props 下发**，不要绕过 `App.vue` 自行从 `localStorage` 读取 token 来判断登录态

---

## 3) 项目架构

### 技术栈

- **运行平台**：[EdgeOne Pages](https://pages.edgeone.ai/zh/document/product-introduction)（Cloud Functions + Edge Functions + Blob）
- **前端**
  - **Vue 3.3+**，统一使用 Composition API `<script setup>`，**禁止 Options API**
  - **JavaScript**（本仓库不使用 TypeScript；需要类型提示用 JSDoc）
  - **Vue Router 4**（仅 `Home` + `NotFound`，登录态由 `App.vue` 控制）
  - **Tailwind v3**（保留 `tailwind.config.js`；同时使用 `@theme {}` 块在 `style.css` 中声明设计 Token）
  - **Vite 7**
  - **原生 `fetch`**（不引入 axios，统一调用 `/api/*` 与 `/legacy-api/*`）
- **后端**
  - **EdgeOne Pages Cloud Functions**（`cloud-functions/api/**.js`）：处理认证、计数器、Passkey、OIDC、初始化与迁移
  - **EdgeOne Pages Edge Functions**（`edge-functions/legacy-api/**.js`）：仅用于读取旧版 `OPEN_KOUNTER` KV 命名空间，导出供 Blob 导入
  - **Blob Store**：通过 `@edgeone/pages-blob` 创建，默认 store 名 `open-kounter`，可经 `OPEN_KOUNTER_BLOB_STORE` 覆盖
- **状态管理**：本仓库**不引入 Pinia / Vuex**。组件间状态优先使用 props/emit；登录态保存在 `App.vue` 的 `ref` 中并下发；持久化仅写 `localStorage` 的 `open_kounter_token` 与非敏感主题偏好 `open_kounter_theme`

### 目录分层

```tree
.
├── client/
│   └── adapter.js              # 客户端适配器（兼容 LeanCloud AV.Counter API）
├── cloud-functions/            # 主后端逻辑（运行于 EdgeOne Cloud Functions）
│   └── api/
│       ├── _api.js             # 通用响应、CORS、鉴权工具
│       ├── _blobStore.js       # Blob Store 工厂 + Key 命名规则 + 读写工具
│       ├── _counterValidation.js # 计数参数与来源白名单统一校验
│       ├── _challengeCleanup.js # 过期 Challenge 分批回收与断点
│       ├── _scheduledCleanupAuth.js # 定时清理专用凭证的派生与校验
│       ├── _oidc.js            # OIDC Discovery/JWKS、PKCE、Cookie 与 Token 校验
│       ├── _passkey.js         # WebAuthn 验签、可信 Origin 与旧凭证公钥兼容
│       ├── _legacyMigration.js # 旧 KV → Blob 迁移逻辑
│       ├── auth.js             # Token / OIDC session 校验
│       ├── counter.js          # 计数器核心（inc / batch_inc / set / delete / list / summary / export / import / set_config）
│       ├── init.js             # 首次初始化与迁移触发
│       ├── passkey.js          # Passkey 注册 / 登录 / 管理
│       ├── maintenance/
│       │   └── challenges.js   # 手动及原生定时清理过期 Challenge
│       └── oidc/
│           ├── login.js        # OIDC 登录发起（state / nonce / code_verifier 写入 Blob）
│           ├── callback.js     # OIDC 回调换码 + ID Token 校验 + 绑定/登录
│           └── status.js       # OIDC 配置与绑定状态查询
├── edge-functions/             # 兼容旧版 KV 的迁移出口（运行于 EdgeOne Edge Functions）
│   └── legacy-api/
│       └── migrate.js          # 导出旧 KV 数据供 Blob 导入
├── src/                        # 前端管理后台（Vue 3 + Vite）
│   ├── components/
│   │   ├── common/
│   │   │   ├── ConfirmModal.vue        # 通用确认弹窗
│   │   │   └── ThemeSwitcher.vue       # 亮色 / 系统 / 暗色三段式切换
│   │   ├── dashboard/
│   │   │   ├── AnalyticsOverview.vue   # 累计指标、热门页面与最近活跃
│   │   │   ├── CounterList.vue         # 计数器列表
│   │   │   ├── DataBackup.vue          # 数据备份与恢复（含旧 KV 迁移入口）
│   │   │   ├── DomainConfig.vue        # 域名白名单配置
│   │   │   ├── OidcManager.vue         # OIDC 绑定管理
│   │   │   ├── PasskeyManager.vue      # Passkey 管理
│   │   │   └── SingleCounterManager.vue# 单个计数器管理
│   │   ├── Dashboard.vue       # 仪表盘主组件
│   │   ├── Login.vue           # 登录组件（Token / Passkey / OIDC 渐进式）
│   │   └── NotFound.vue        # 404
│   ├── views/
│   │   └── Home.vue            # 首页（根据 isLoggedIn 切换 Login / Dashboard）
│   ├── router/index.js         # 路由表
│   ├── App.vue                 # 根组件（登录态 + OIDC 回调处理 + 全局 layout）
│   ├── main.js                 # 入口
│   ├── style.css               # ⭐ 唯一全局 CSS（@theme + 主题映射 + 基础样式）
│   ├── utils/latestRequest.js # 请求取消、超时和响应序号保护
│   ├── utils/requestJson.js  # 登录请求超时、取消与响应校验
│   ├── utils/passkeyCeremony.js # 独立 Passkey 流程及取消清理
│   └── theme.js                # 主题偏好读取、解析、应用与持久化
├── tests/                      # Node 内置测试：认证、存储、适配器、登录与请求乱序
├── docs/blob-concurrency.md     # Blob 并发边界、遗留锁恢复和后续设计
├── scripts/build-makers-manifest.mjs # 生成 Makers 私有路由/定时配置
├── other/                      # 文档资源（演示图等）
├── edgeone.json                # EdgeOne 配置（构建命令 / 输出目录 / 函数路由）
├── index.html
├── package.json
├── tailwind.config.js          # Tailwind v3 配置（颜色 token 与 @theme 保持同步）
├── vite.config.js
├── README.md
└── AGENTS.md                   # 本文件
```

### 分层依赖方向

`cloud-functions/api/_blobStore.js  ←  cloud-functions/api/_api.js  ←  cloud-functions/api/{auth,counter,init,passkey,oidc/*}.js`
`src/components/dashboard/*  ←  src/components/Dashboard.vue  ←  src/views/Home.vue  ←  src/App.vue`
前端**不直接 import 后端代码**；后端不持有任何前端引用。

### 禁止

- 在 `cloud-functions/api/{auth,counter,init,passkey,oidc/*}.js` 中**直接 new BlobStore**；必须走 `_blobStore.js` 暴露的工厂与读写工具
- 在 `cloud-functions/api/**` 中**手写 CORS 头与 401/200 JSON 响应**；统一走 `_api.js` 的 `successResponse` / `failResponse` / `optionsResponse`
- 在前端组件中直接读 / 写 `localStorage.open_kounter_token` 之外的认证字段；登录态以 `App.vue` 为单一信源
- 引入 Pinia / Vuex / axios / Element Plus / 任何 UI 组件库（保持零业务依赖膨胀）
- 重新引入旧版 KV 写入路径；所有写入只走 Blob

### 内聚与耦合

- 同业务域聚合：`cloud-functions/api/counter.js` ↔ `src/components/dashboard/CounterList.vue` / `SingleCounterManager.vue`
- Blob Key 命名集中在 `_blobStore.js`（如 `passkeyManagementTokenKey`），**禁止在业务文件里拼接 key 字符串**
- **判定**：改一个功能只需改前后端各一处；若需同时改多个文件同名函数，说明内聚不足

---

## 4) 代码变更同步文档规范

修改代码时，必须同步更新所有相关文档，确保文档与代码始终一致。

### 适用范围

所有涉及以下变更的场景：

- 新增 / 修改 / 删除 API 端点或参数（含 `action` 枚举值）
- 新增 / 修改 / 删除 Blob Key 命名 / Schema 字段
- 新增 / 修改 / 删除 路由
- 新增 / 修改 / 删除 环境变量
- 新增 / 修改 / 删除 公共样式类或设计 Token
- 新增 / 修改 / 删除 命名约定、目录分层、编码规范

### 需要同步更新的文件

| 代码变更位置 | 需同步更新的文档 |
|---|---|
| `cloud-functions/api/**`（新增 action / 端点） | [README.md](README.md) §API 接口文档 |
| `cloud-functions/api/_blobStore.js`（新增 Key / Schema） | 本文件 §8 Blob Schema 表 |
| `src/router/index.js`（新增路由） | 本文件 §7 |
| `src/style.css` / `tailwind.config.js`（新增 Token / 公共类） | 本文件 §5.2 设计 Token 表 |
| 新增环境变量 | 本文件 §9 + [README.md](README.md) §环境变量一览 |
| 重构 / 迁移阶段性完成 | 本文件 §12 进度表、[README.md](README.md) |

### 执行步骤

1. **识别影响范围**：改代码后定位对应文档章节
2. **同步更新**：保证命名 / 字段 / 路径完全一致
3. **验证格式**：本文件所有表格必须列全强制字段，不得只写“类似”或“参考”

---

## 5) 样式规范（强制，核心）

### 5.1 CSS 工具链

- **唯一全局 CSS 入口**：[src/style.css](src/style.css)
- **设计 Token 双声明**：颜色 / 间距等 Token 在 `style.css` 的 `@theme {}` 中声明的同时，必须在 [tailwind.config.js](tailwind.config.js) 的 `theme.extend.colors` 中保持一一对应（Tailwind v3 IntelliSense + `@apply` 语义解析依赖 config）
- 公共按钮与表单控件视觉统一使用 `style.css` 的 `@layer components` 语义类；组件模板只补充尺寸与布局，不重复声明背景、边框、文字色、圆角和交互状态
- 业务一次性样式**直接在模板写 Tailwind 原子类**，不再为此写 `<style scoped>`
- `<style scoped>` 仅在以下场景使用：
  1. 复杂 `@keyframes` 动画
  2. 深层子组件样式穿透（`:deep()`）
  3. 组件特有且明确不需复用的一次性样式（如 `App.vue` 中的 `.animate-gradient-xy`）
- **严禁**在 `<style scoped>` 中重复定义已有的语义化原子类组合

### 5.2 设计 Token

**使用原则**：业务代码优先用语义化 Token（`bg-dark-900` / `text-primary` / `border-dark-700`），**不直接使用 Tailwind 默认调色板的中间色阶**（如 `bg-slate-700` / `text-zinc-400`）。历史 `dark-*` 名称继续保留作为自适应表面 Token，实际值由 `data-theme` 决定。

| Token | 暗色值 | 亮色值 | 用途 |
|---|---|---|---|
| `dark-900` | `#141414` | `#f4f6f8` | 页面最底层背景（`body`） |
| `dark-800` | `#1d1e1f` | `#ffffff` | 顶栏 / 卡片背景 |
| `dark-700` | `#2b2d30` | `#e5e7eb` | 分割线 / 二级容器 |
| `dark-600` | `#4C4D4F` | `#c2c8d0` | 边框 / 占位文本 |
| `content-strong` | `#f9fafb` | `#111827` | 404 渐变等需要明确强文字色的场景 |
| `on-accent` | `#ffffff` | `#ffffff` | 主色 / 成功 / 警示 / 危险实色按钮上的固定白字 |
| `control` | `#2b2d30` | `#ffffff` | 次级按钮与分段控件背景 |
| `control-hover` | `#37393d` | `#f1f5f9` | 次级按钮与分段控件 hover |
| `control-border` | `#4C4D4F` | `#cbd5e1` | 次级按钮与分段控件默认边框 |
| `control-border-hover` | `#6b7280` | `#94a3b8` | 次级按钮与分段控件 hover 边框 |
| `field` | `#141414` | `#ffffff` | 输入框、选择器与类输入条目背景 |
| `field-disabled` | `#1d1e1f` | `#f1f5f9` | 禁用输入框背景 |
| `field-border` | `#4C4D4F` | `#cbd5e1` | 输入框、选择器与类输入条目默认边框 |
| `field-border-hover` | `#6b7280` | `#94a3b8` | 输入框、选择器与类输入条目 hover 边框 |
| `grid-line` | `#ffffff0a` | `#0f172a0a` | 页面低对比度网格线 |
| `primary` | `#409eff` | `#1d4ed8` | 品牌主色（按钮 / 选中态 / 链接 hover） |
| `primary-hover` | `#66b1ff` | `#1e40af` | 主色 hover 态 |
| `primary-dark` | `#3a8ee6` | `#1e3a8a` | 主色加深态（渐变收尾色 / 标题 gradient） |
| `success` / `success-hover` | `#22c55e` / `#16a34a` | `#065f46` / `#064e3b` | 成功操作与状态色 |
| `warning` / `warning-hover` | `#f59e0b` / `#d97706` | `#92400e` / `#78350f` | 警示操作与状态色 |
| `danger` / `danger-hover` | `#ef4444` / `#dc2626` | `#b91c1c` / `#991b1b` | 危险操作与状态色 |
| `gray-100` ~ `gray-600` | Tailwind 默认 | `#111827` ~ `#9ca3af` | 自适应文字层级；正文默认 `text-gray-200` |

**状态色半透明用法（来自 Tailwind 默认调色板，规范保留）**：

| 场景 | 推荐组合 |
|---|---|
| 状态成功（提示横幅 / 徽章） | `bg-green-500/10 text-green-400 border border-green-500/20` |
| 状态失败 | `bg-red-500/10 text-red-400 border border-red-500/20` |
| 状态警告 | `bg-amber-500/10 text-amber-400 border border-amber-500/20` |

> 操作按钮与状态徽章均通过语义 Token 表达；半透明状态徽章保留使用 `green-500/10` 等 Tailwind 默认色（视为状态语义色，不算"硬编码"）。

**禁止**在新代码中出现 `#1d1e1f` / `#409eff` 等硬编码色值（含 `rgba`），必须经 Token 引用。需要新色时**先加到 `style.css` 的 `@theme` 与 `tailwind.config.js`，再使用**。

### 5.3 主题模式

- 支持 `light` / `system` / `dark` 三种主题偏好，默认 `system`
- `App.vue` 是主题状态单一信源；`theme.js` 负责读取、解析、应用与持久化，`ThemeSwitcher.vue` 只通过 props/emit 交互
- 偏好写入 `localStorage.open_kounter_theme`；只允许 `light` / `system` / `dark`，无效或缺失值回退到 `system`
- `<html data-theme>` 保存解析后的 `light` / `dark`，`<html data-theme-mode>` 保存用户选择；系统模式必须监听 `prefers-color-scheme` 变化并实时更新
- 组件继续使用全局 Token，不在模板中成批堆叠 `dark:` 变体；亮色映射统一维护在 `style.css` 的 `:root[data-theme='light']`
- 亮色下 `.text-white` 会映射为强文字色；实色品牌 / 状态按钮必须使用 `text-on-accent` 保持固定白字

### 5.4 响应式与断点

- 统一使用 Tailwind 默认断点：`sm (640)` / `md (768)` / `lg (1024)` / `xl (1280)`
- **移动端优先**：基础样式 mobile，桌面用 `md:` / `lg:` 覆盖
- **禁止**在 `<style scoped>` 内写 `@media (...)`；改用 Tailwind 响应式前缀

### 5.5 公共视觉模式

| 模式 | 推荐组合 |
|---|---|
| 卡片容器 | `bg-dark-800 border border-dark-700/50 rounded-2xl shadow-lg shadow-dark-900/20` |
| 顶栏（sticky） | `sticky top-0 z-40 bg-dark-800/80 backdrop-blur-xl border-b border-dark-700/50` |
| 主操作按钮 | `button-primary` |
| 次操作按钮 | `button-secondary` |
| 成功操作按钮 | `button-success` |
| 警示操作按钮 | `button-warning` |
| 危险操作按钮（轮廓） | `button-danger` |
| 危险操作按钮（实色，仅用于 ConfirmModal） | `button-danger-solid` |
| 成功提示操作（轮廓） | `button-success-outline` |
| 警示提示操作（轮廓） | `button-warning-outline` |
| 普通输入框 | `form-control` |
| 原生选择器 | `form-select` |
| 紧凑按钮尺寸 | `button-compact`（固定 `h-8`、`text-xs`、`rounded-md`） |
| 紧凑输入框尺寸 | `field-compact`（固定 `h-8`，移动端保留可读字号，桌面缩为 `text-sm`） |
| 表格分割 | `divide-y divide-dark-700/50` |
| 状态成功 | `bg-green-500/10 text-green-400 border border-green-500/20` |
| 状态失败 | `bg-red-500/10 text-red-400 border border-red-500/20` |
| 状态警告 | `bg-amber-500/10 text-amber-400 border border-amber-500/20` |
| 容器宽度 | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` |

---

## 6) 前端编码规范

适用目录：`src/`

### 6.1 SFC 与组件

```vue
<script setup>
// imports（按 §6.6 分组）
</script>

<template>...</template>

<style scoped>
/* 仅复杂动画 / :deep() / 组件特有的一次性样式 */
</style>
```

- 文件名 / 注册名：大驼峰 `OidcManager.vue`
- 模板中引用：大驼峰 `<OidcManager />` 或 kebab-case 任选其一，**单文件内统一**
- 目录归属：仪表盘业务卡片放 `components/dashboard/`，通用组件放 `components/common/`，页面级组件放 `views/`

### 6.2 状态与数据流

- **登录态单一信源**：`App.vue` 的 `token` / `isLoggedIn` ref；通过 `<router-view :token :isLoggedIn @login>` 下发
- **主题状态单一信源**：`App.vue` 的 `themeMode` ref；切换控件通过 `update:modelValue` 交给 `App.vue` 写入 `open_kounter_theme`
- 子组件想要刷新登录态：`emit('login', newToken)` 冒泡到 `App.vue`，由 `App.vue` 写 `localStorage`
- 子组件**不要**直接写 `localStorage.setItem('open_kounter_token', ...)`
- 跨组件共享数据：优先 props / emit；多层共享用 `provide / inject`
- **不引入 Pinia**
- 仪表盘由 `CounterList` 的 `list + includeSummary: true` 请求向 `Dashboard` 上报概览与加载状态；`AnalyticsOverview` 仅消费 props 并发出刷新事件，不额外请求数据。
- 列表读取通过 `src/utils/latestRequest.js` 取消旧请求、校验序号并执行 15 秒超时；卸载组件必须取消请求。
- 已保存 Token 的校验遇到网络、HTTP 服务错误或无效响应时必须保留本地 Token，保持未认证状态并提供重试；仅明确认证失效时清除 Token，禁止把网络失败视为退出登录。

### 6.3 API 调用约定

- 统一使用原生 `fetch`，路径以 `/api/...` 或 `/legacy-api/...` 开头（EdgeOne 自动路由到 Cloud / Edge Functions）
- 请求体统一 JSON：`headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...args })`
- 鉴权接口必须带 `Authorization: Bearer ${token}`
- 响应结构统一：`{ code: 0|1000|1404, data?, message? }`；`code === 0` 为成功
- 错误处理：`try/catch` 包裹 `await fetch`，失败把 `data.message` 写入组件的 `message` ref 提示用户；**禁止 `alert` / `confirm`**，确认框统一走 `components/common/ConfirmModal.vue`
- 登录相关 JSON 请求使用 `src/utils/requestJson.js`：默认 15 秒，覆盖响应体读取；支持取消，校验 HTTP 及业务响应结构，不自动重试写入或一次性凭证兑换。
- Passkey 前端流程使用 `src/utils/passkeyCeremony.js`，每个实例只生成一次 Challenge。取消、失败、卸载或 `pagehide` 仅尽力清理本次 ID；清理独立 5 秒超时，离开页面使用 `keepalive`，不能复用已取消的 signal。生成响应迟到时清理返回的 ID；无法收到 ID 则依赖手动回收，成功验证不重复取消。

### 6.4 类型定义（JSDoc）

本仓库不使用 TypeScript；类型约定通过 JSDoc 表达：

```js
/**
 * @typedef {Object} CounterItem
 * @property {string} target
 * @property {number} time
 * @property {number} created_at
 * @property {number} updated_at
 */
```

| 场景 | 命名 |
|---|---|
| 列表 item | `XxxItem` |
| 详情 | `XxxDetail` |
| 创建 / 更新入参 | `XxxCreate` / `XxxUpdate` |
| 响应结果 | `XxxResult` |

**禁止**：`VO` / `BO` / `DTO` 等后缀。

### 6.5 表单与敏感字段

- 容器：`max-w-2xl space-y-4`
- label：`block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1`
- input：直接写 `<input class="bg-dark-700 border border-dark-600 ...">`，不引入 UI 库
- help 文本：`text-xs text-gray-500 mt-1`
- **敏感字段（Token / OIDC Client Secret / Passkey 私钥）**：
  - 后端响应仅返回 `xxxSet: boolean` 或脱敏字段（如 OIDC Issuer 可见、Secret 不可见）
  - 前端 `<input type="password" autocomplete="new-password" />`
  - **留空保存 = 不修改**，placeholder 统一写“留空保持不变”
  - **绝不**在 `console.log` 输出敏感字段

### 6.6 import 分组排序（强制）

`<script setup>` 内 import 按以下顺序分组，组间空一行，组内按字母升序：

1. Vue 核心（`vue` / `vue-router`）
2. 第三方库
3. `../views/...`
4. `../components/...`（按 `dashboard/` → `common/` → 平级顺序）
5. 其余（相对路径资源 / 静态常量）

样例：

```js
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import CounterList from './dashboard/CounterList.vue'
import OidcManager from './dashboard/OidcManager.vue'
import ConfirmModal from './common/ConfirmModal.vue'
```

### 6.7 登录页渐进式检测（强制）

`Login.vue` 加载时必须先并发执行以下三个状态检测，再决定 UI 展示：

1. `POST /api/auth { action: 'get_status' }`：拿到 `initialized` / `oidcLoginEnabled`
2. `POST /legacy-api/migrate { action: 'status' }`：拿到 `hasLegacyData`
3. `POST /api/passkey { action: 'listCredentials', data: { username: 'admin' } }`：拿到是否已绑定 Passkey

UI 规则：

- 检测中显示加载占位（最少展示 600ms，避免闪烁）
- 三项检测最多等待 5 秒，必须支持卸载取消与旧响应保护；可选检测失败后隐藏对应能力，不永久阻塞 Token 表单。旧 KV 的 `OPEN_KOUNTER not bound` 属于正常未开启。检测重试仍并发执行并保留至少 600ms 占位。
- 初始化状态区分 `true` / `false` / 未知；检测错误不等于未初始化。未知时显示重试入口，Token 提交走 `/api/auth`；仅状态明确为 `false` 时可调用 `/api/init`。
- 仅当**对应能力确认开启 / 已绑定**时才在登录页展示对应入口（OIDC 按钮 / Passkey 按钮 / 旧 KV 迁移入口）
- Token 登录始终可用；OIDC / Passkey 为可选渐进增强

新增登录方式时必须**保持渐进式检测**：未配置 / 未绑定 → 完全隐藏入口，不要在 UI 上呈现“灰态按钮”。

### 6.8 访客适配器

- `client/adapter.js` 将本次递增目标合并为一个 `batch_inc`，直接使用服务端返回计数更新显示；不递增的目标独立读取，读取挂起不得阻断递增。
- 先检查统计开关、DNT 与本地访问策略，再判断 UV 资格；只有确认 UV 递增成功后才写 24 小时标记。失败不显示未确认的 `+1`，不把读取失败伪装成有效的零值。
- 请求设置 15 秒超时并覆盖响应体读取；禁止自动重试非幂等递增。一个页面 Target 解析失败时，不得阻断其它站点统计。
- 此处的访客 UV 标记属于接入网站，独立于管理后台的 Token 与主题偏好。

---

## 7) 路由

- 路由表：[src/router/index.js](src/router/index.js)
- **仅两个有效路由**：`/` (Home) 与 `/404` (NotFound)；其它路径 redirect 到 `/404`
- 登录态切换不走路由，由 `views/Home.vue` 根据 `isLoggedIn` props 渲染 `Login` 或 `Dashboard`
- **新增路由**时必须：
  - 使用懒加载：`component: () => import('../views/Xxx.vue')`
  - 在本文件 §3 目录结构 + §7 同步登记
  - 若涉及鉴权，必须由 `App.vue` 在 `isLoggedIn === false` 时拦截重定向（当前未实现 router guard）

---

## 8) 后端规范（Cloud Functions / Edge Functions / Blob）

### 8.1 Cloud Function 文件结构

每个 `cloud-functions/api/**.js` 必须导出 `onRequest({ request, env })` 函数，内部模板：

```js
import {
  failResponse,
  getCorsHeaders,
  optionsResponse,
  requireAuth,
  successResponse
} from './_api.js'
import { createOpenKounterStore } from './_blobStore.js'

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse(request)

  const store = createOpenKounterStore(env)

  try {
    // 公开接口 / 鉴权接口的判断
    const { state } = await requireAuth(request, store, env)
    const body = await request.json()
    // ... 业务逻辑
    return successResponse(request, { /* data */ })
  } catch (e) {
    return failResponse(request, e.message)
  }
}
```

### 8.2 响应规范

- **成功**：`successResponse(request, data)` → `{ code: 0, data }`
- **失败**：`failResponse(request, message)` → `{ code: 1000, message }`
- **未找到**：`failResponse(request, message, RES_CODE.NOT_FOUND)` → `{ code: 1404, message }`
- **HTTP status 一律 200**（`OPTIONS` 除外，使用 204）；前端通过 `code` 判断业务结果
- **CORS**：所有响应必须经 `getCorsHeaders(request)` 注入 CORS 头；不要手写

### 8.3 鉴权

- 管理接口必须首行调用 `await requireAuth(request, store, env)`
- 校验顺序：`env.ADMIN_TOKEN`（环境变量直配）→ Blob 中的 `state.token`
- **禁止**在业务函数内重复实现 token 比对

### 8.4 Blob 操作

- 创建 Store：仅通过 `createOpenKounterStore(env)`，不要直接 `new BlobStore`
- 所有 Key 必须在 `_blobStore.js` 中以**纯函数**形式导出（如 `passkeyManagementTokenKey(id)`），业务代码 import 后调用，**禁止散落字符串拼接**
- 读：`readJson(store, key)`；写：`writeJson(store, key, value)`；删：`deleteJson(store, key)`
- 锁通过 SDK `PreconditionFailedError` 判断条件创建冲突；只重试获取锁，不重放业务回调。禁止按 `expiresAt` 自动抢占或删除另一所有者的锁；超时报错，遗留锁按 `docs/blob-concurrency.md` 维护恢复。强一致读不是原子递增。
- 导入先校验全部计数与域名配置，再覆盖计数文档；禁止预先删除 `system/counters.json`。旧迁移不得使用缺失前缀清理 Store。多文档操作不保证事务。
- 强一致：核心读路径优先使用强一致选项（参见 `_blobStore.js` 内的封装），禁止业务层自行降级到最终一致
- 计数及来源白名单校验集中在 `_counterValidation.js`。计数读取、写入和导入统一校验 Target：非空、非纯空白字符串，长度不超过 2048，有效 Key 原样保留。通过自有属性访问和安全属性写入处理 `__proto__` 等合法字符串 Key，不依赖对象原型链。
- `set` 与导入统一接受非负安全整数或纯数字字符串；递增检查溢出。`batch_inc` 最多 100 项，空批次返回 `[]` 且不持锁，全部项目校验通过后才获取锁；任何项目失败不得写入部分计数。
- `set_config` 与 `import_all` 使用相同白名单校验及规范化：HTTP(S) Origin、`*.example.com` 或 `*`；去空白、规范化并去重，拒绝凭证、非根路径、查询及 fragment。通配项仅按 hostname 的点边界匹配子域，不匹配根域或近似后缀域名。空白名单、`*` 和无 Origin 的兼容行为保留；来源白名单不替代鉴权或防刷。

### 8.5 Edge Function 适用范围

`edge-functions/legacy-api/migrate.js` **仅用于读取旧版 `OPEN_KOUNTER` KV**：

- 不在此处写入任何数据
- 不在此处实现新业务；新需求一律放 Cloud Functions
- 用户已无旧 KV 数据时，可不绑定该 KV 命名空间

### 8.6 OIDC 子模块

- 路径：`cloud-functions/api/oidc/{login,callback,status}.js`
- `login.js` 登录使用 GET；绑定使用 Bearer 鉴权的 POST `{ mode: "bind" }`，返回 `authorizationUrl`。禁止 URL 传管理员 Token。保存 `state` / `nonce` / `codeVerifier`（PKCE S256）及浏览器摘要，TTL 为 5 分钟。Cookie 必须使用 HttpOnly / Secure / SameSite=Lax。
- `callback.js` 校验浏览器 Cookie → 唯一消费 `state` → 携带 PKCE verifier 换码 → `jose` 验签及 `iss`/`aud`/`exp`/`iat`/`nonce`/`azp` 校验 → 按 `issuer + sub` 绑定/登录。禁止未验签的 JWT 或 userinfo 回退。临时 Session 有效期 60 秒，仅存 Token 摘要；兑换时核对当前绑定和 Token。
- JSON 接口继续使用 `_api.js`；OIDC 浏览器跳转允许 302，统一通过 `_oidc.js` 设置不缓存、清理 Cookie 和安全重定向。
- `status.js` **只回传 boolean / 公开字段**（如 `oidcLoginEnabled` / `bound`），**绝不回传 `OIDC_CLIENT_SECRET`**


### 8.7 Passkey 校验

- 使用兼容 Node.js 20 的 `@simplewebauthn/server` 验证注册及登录。要求用户验证，校验 challenge、Origin、RP ID、签名及签名计数器，登录和管理使用不同 `purpose`。
- 可信 Origin 仅来自 `PASSKEY_ORIGIN` 或服务端请求 URL；不从客户端 `Origin` / `Referer` 头建立信任。内部转发域名不同必须配置 `PASSKEY_ORIGIN`。
- 旧 `publicKey` 的 attestationObject 仅在 RP ID / Credential ID 匹配且认证签名有效后转换为 COSE 格式。无法验证时拒绝并提示 Token 登录重绑，不批量删除旧凭证。
- Challenge、OIDC state/session、管理 Token 必须通过 `consumeTransientJson` 的条件创建消费回执唯一消费；旧版管理 Token 缺少 `verificationVersion: 1` 时拒绝。
- 每个 Passkey 流程条件创建独立随机 Challenge ID，不复用、不续期；不能通过用户名删除另一个流程的 Challenge。新流程不设置 `currentChallengeId`；仅消费或取消相同 ID 时，在用户锁内清理匹配的历史引用。
- 同一凭证的读取、验签及签名计数器写回必须在用户锁内完成，不能因并发写入使计数器回退；严格计数器仍拒绝乱序旧断言。重新注册保持替换旧凭证的语义，提交串行执行。
- `cancelChallenge` 只接受本次生成响应中的 ID（1～128 位字母、数字、下划线、连字符），按 ID 唯一消费；对已过期原文档直接删除。取消与旧迁移共用 `legacyMigrationLockKey`，不删除消费回执。

### 8.8 本轮涉及的 Blob Key / 字段

| Key（由 `_blobStore.js` 工厂生成） | 字段 | 生命周期 / 兼容 |
|---|---|---|
| `system/counters.json` | `items[target]: { target, time, created_at, updated_at }`, `updatedAt`, `version` | 维持 `2.1`；不改变计数布局 |
| `system/maintenance/passkey-challenges.json` | `cursor: null \| { page: string, afterKey: string }`, `updatedAt` | `page` 为 SDK 原始分页游标，`afterKey` 为本页已处理的最后 Key；完成全扫后 `cursor: null` |
| `passkey/users/<编码 id>.json` | `id`, `username`, `token`, `credentialIds`, `createdAt`, `updatedAt`；旧数据可含 `currentChallengeId` | 新流程不写 `currentChallengeId`；历史引用仅在消费/取消相同 ID 时清理，不用于限制并行流程 |
| `passkey/credentials/<编码 id>.json` | `id`, `publicKey`, `publicKeyFormat`, `counter`, `transports`, `deviceType`, `backedUp`, `userId`, `webAuthnUserID`, `createdAt`, 可选 `lastUsedAt` | 新格式 `publicKeyFormat: "cose"`；旧格式无此标记，成功验签后转换 |
| `passkey/challenges/<编码 id>.json` | `challenge`, `userId`, `purpose`, `origin`, `rpID`, `createdAt`, `expiresAt`；注册另含 `username`, `token`, `webAuthnUserID` | 5 分钟；每次流程独立且条件创建，`purpose` 为 `registration` / `authentication` / `management`，旧无上下文 challenge 需重发；过期不自动删除 |
| `passkey/management-tokens/<编码 id>.json` | `userId`, `verificationVersion: 1`, `createdAt`, `expiresAt` | 5 分钟、唯一消费；拒绝旧版未验证凭证 |
| `oidc/states/<编码 id>.json` | `state`, `nonce`, `mode`, `tokenHash`, `codeVerifier`, `issuer`, `clientId`, `redirectUri`, `browserHash`, `createdAt`, `expiresAt` | 5 分钟、唯一消费；`tokenHash` 仅绑定模式使用 |
| `oidc/sessions/<编码 id>.json` | `sessionId`, `sub`, `issuer`, `boundAt`, `tokenHash`, `createdAt`, `expiresAt` | 60 秒、唯一消费；不保存实际管理员 Token |
| `auth/consumed/<编码后的完整凭证 Key>` | `expiresAt`, `consumedAt` | 通过 `onlyIfNew` 创建；不会自动回收，维护时在凭证过期且无在途消费请求后清理 |
| `locks/counters-document.json`, `locks/system-state.json`, `locks/passkey/users/<编码 id>.json`, `locks/legacy-migration.json` | `requestId`, `expiresAt`, `createdAt` | 所有者正常释放；`expiresAt` 仅诊断，不授权抢占，异常遗留需维护恢复 |

认证库仅用于 Cloud Functions，不导入前端。为兼容现有 Bearer 登录架构，成功的 Passkey/OIDC 登录交换可以返回实际管理 Token；状态查询和其它管理响应仍禁止泄露凭证。

### 8.9 Challenge 回收与原生定时任务

- `POST /api/maintenance/challenges` 有 `Authorization` 时必须经 `requireAuth`；没有该头时，仅接受 `_scheduledCleanupAuth.js` 校验的 JSON `cleanupToken`（请求体最多 1024 字节）。不能将该凭证用于其它管理端点，不根据自报 cron 头、URL 参数或 `scheduled: true` 放行。鉴权前禁止扫描或写入 Blob。
- 接口不接受调用方指定 Key、前缀或截止时间；OPTIONS 和 JSON 继续使用 `_api.js`。返回 `scanned` / `deleted` / `skipped` / `failed` / `hasMore`，不返回凭证内容。专用凭证调用仅记录脱敏执行统计，不记录请求体。
- Makers 会用已解析 JSON 遮蔽 `Request.body`；有界读取须通过原型 getter 获取原始流，不能直接调用 `request.body.getReader()`，也不能用重新序列化后的 JSON 大小替代原始字节限制。
- `_challengeCleanup.js` 只回收 `getStoragePrefixes().passkeyChallenges` 中已过期至少 60 秒的原文档；强一致分页每次最多 100 条，约 10 秒协作预算，在途操作完成后才保存进度和释放锁，禁止超时后放任写操作继续执行。
- 维护 Key 集中在 `challengeCleanupStateKey()`；SDK 原始分页游标不能用返回 Key 替代。读取或删除临时失败保留重试位置，坏 JSON 跳过留存，下一轮全扫再检查。
- 回收与旧 KV 迁移共用 `legacyMigrationLockKey()`，获取只尝试一次，不按 TTL 抢占。只删除过期原文档，不删除 `auth/consumed/`、凭证、用户或其它锁；消费回执按 `docs/blob-concurrency.md` 的条件单独维护。
- `edgeone.json` 声明原生任务 `passkey-challenge-cleanup`，每天 03:00（`Asia/Shanghai`）执行一批，不在登录时全量扫描；积压通过断点由后续运行或手动调用继续处理。
- Makers 构建命令为 `npm run build:makers`，普通 `npm run build` 保留前端构建。`scripts/build-makers-manifest.mjs` 根据公开配置生成私有 `.edgeone/routes.json`，保留函数、静态文件及 SPA 路由；根配置不得写入调度凭证，构建产物不得进入 `dist/` 或公开 assets。
- 生成器当前仅支持静态 JavaScript handler 路由与 SPA；动态路由、其它运行时、框架默认导出、Middleware、Agents 或非空 `headers` / `redirects` / `rewrites` 需先扩展生成器并补回归，不能忽略这些配置继续构建。
- 密钥 `OPEN_KOUNTER_CLEANUP_SECRET` 至少 32 字符，构建与运行时一致；`createScheduledCleanupToken` 用固定用途 `open-kounter:maintenance:passkey-challenges:v1` 派生 HMAC-SHA256 base64url 凭证。校验严格格式并使用恒时比较。凭证可重放但权限只限清理，不能宣称它证明了平台调用身份。
- 缺少密钥时产物省略定时任务、保留手动入口；非空弱密钥使 Makers 构建失败。每次原子重写 manifest 并设权限 `0600`；轮换密钥必须重新构建部署。配置输出字段使用 `outputDirectory`。

---

## 9) 安全基线（必须遵守）

1. **禁止硬编码**密钥 / 密码 / 令牌（`ADMIN_TOKEN` / `OIDC_CLIENT_SECRET` 等），即使是测试环境
2. **敏感字段**仅显示 `xxxSet` 布尔状态或脱敏字符，不向前端泄露明文
3. `console.log` **不允许**输出 token / secret / id_token / code_verifier 全量；调试日志必须脱敏（如 `token.slice(0, 4) + '***'`）
4. **CSRF**：OIDC `state` 参数必须经 Blob 校验后立即销毁（一次性）
5. **HTML 注入**：`v-html` 仅在可信内容场景使用，必须先 sanitize
6. **外链** `<a target="_blank">` 必须带 `rel="noopener noreferrer"`
7. **CORS**：默认回显 `Origin`，业务上若需收紧白名单，统一改 `_api.js#getCorsHeaders`，**不要在单个 Cloud Function 中各自实现**

---

## 10) 质量门禁（提交前自检）

```bash
npm test                # 认证、存储、请求乱序回归必须通过
npm run build           # 构建必须通过，无新告警
```

**提交前检查清单**：

- [ ] `npm run build` 通过、无新增告警 / chunk 警告
- [ ] 无新增硬编码色值（HEX / RGB / RGBA），新色已加到 Token
- [ ] 无新增 `<style scoped>` 中的 `@media (...)`
- [ ] 无新增 Options API 组件
- [ ] 无新增直接 `import` 后端文件 / 直接 `new BlobStore`
- [ ] 无新增 `alert` / `window.confirm`（统一走 `ConfirmModal.vue` 与组件内 `message` 提示）
- [ ] 敏感字段没有出现在 `console.log` / 响应明文中
- [ ] import 已按 §6.6 分组
- [ ] 相关文档（本文件 / README）已同步更新
- [ ] 新增环境变量已在 README §环境变量一览 + 本文件 §11 登记

---

## 11) 环境变量

| 变量名 | 必需 | 用途 |
|---|---|---|
| `OPEN_KOUNTER_BLOB_STORE` | 否 | 自定义 Blob Store 名称，默认 `open-kounter` |
| `OPEN_KOUNTER_CLEANUP_SECRET` | 启用定时清理时需要 | 至少 32 字符随机密钥，构建与运行时一致；缺失停用原生定时任务，手动清理仍可用，轮换需重新构建部署；禁止前端暴露 |
| `OPEN_KOUNTER` | 否（仅迁移期） | 旧版 KV 命名空间绑定，仅 `edge-functions/legacy-api/migrate.js` 使用 |
| `ADMIN_TOKEN` | 否 | 预设管理员 Token；优先级高于 Blob 中存储的 token |
| `PASSKEY_RP_ID` | 否 | Passkey RP ID，默认使用当前域名 hostname |
| `PASSKEY_ORIGIN` | 否 | 可信公开 Origin；默认使用服务端请求 URL，内部转发域名不同须配置，禁止从 Origin/Referer 请求头推导 |
| `PASSKEY_RP_NAME` | 否 | Passkey 显示名称，默认 `Open Kounter` |
| `OIDC_ISSUER` | 否 | OIDC Issuer URL；与下列三项任一缺失 → OIDC 视为未启用 |
| `OIDC_CLIENT_ID` | 否 | OIDC Client ID |
| `OIDC_CLIENT_SECRET` | 否 | OIDC Client Secret（仅服务端使用，禁止下发前端） |
| `OIDC_REDIRECT_URI` | 否 | OIDC 回调地址，必须与 OIDC Provider 注册地址完全一致 |

新增环境变量必须：

1. 同步更新本表
2. 同步更新 [README.md](README.md) §环境变量一览
3. 在使用处加入“缺失则降级 / 报错”的兜底逻辑，**不要让缺失变量直接导致 500**

---

## 12) Git 约定

- 提交格式：`<type>(<scope>): <subject>`
- type ∈ `feat` / `fix` / `refactor` / `style` / `docs` / `chore`
- scope 推荐：`frontend` / `backend` / `oidc` / `passkey` / `counter` / `blob` / `migrate` / `docs`
- 例：
  - `feat(oidc): add progressive detection on login page`
  - `refactor(blob): centralize key naming in _blobStore.js`
  - `docs: update AGENTS.md with backend conventions`
- 分支：`main`（生产）、`feature/<name>`、`fix/<name>`
- 大型重构按阶段拆 PR，每个 Phase 独立提交、可单独回滚

---

## 13) 演进路线（占位）

- [x] **Phase 0**：Blob 主存储落地、KV 迁移工具完成
- [x] **Phase 1**：Passkey 无密码登录
- [x] **Phase 2**：OIDC 单点登录 + 登录页渐进式检测
- [x] **Phase 3**：亮色 / 跟随系统 / 暗色三段式主题切换（运行时 Token 映射 + 系统主题监听）
- [x] **认证与可靠性修复**：WebAuthn/OIDC 验证、一次性凭证消费、导入校验、列表/概览共用读取、请求乱序保护；Blob 高并发与故障恢复方案见 `docs/blob-concurrency.md`，尚未迁移存储。
- [x] **计数与登录故障处理**：统一计数/白名单校验及批量上限，适配器合并请求并在确认成功后记录 UV；登录检测区分未知与未初始化，网络失败保留 Token 并支持重试。
- [x] **Passkey 生命周期**：独立 Challenge、前端按本次 ID 尽力取消、签名计数器串行更新、受鉴权的分批回收接口及可通过专用密钥启用的 Makers 原生每日调度；消费回执保留。
- [ ] **Phase 4**：继续抽离公共 UI 类（按钮 / 输入框已完成；卡片待完成），减少模板原子类长串

每个阶段完成后必须更新本节进度。

---

本规范适用于 `open-kounter` 仓库下所有 AI 代理协作与代码改动。如与用户当次明确需求冲突，按“指令优先级”处理并在输出中说明取舍。

# API 参考

[返回首页](../README.md) · [部署与配置](deployment.md) · [维护与升级](maintenance.md)

主 API 的基础路径为 `/api`，旧 KV 迁移出口为 `/legacy-api/migrate`。JSON 响应使用 `code: 0` 表示成功、`1000` 表示失败、`1404` 表示未找到；通常 HTTP 状态为 200，调用端还须检查业务 `code`。`OPTIONS` 返回 204，OIDC 浏览器跳转使用 302。

**计数参数约束**：读取、递增、设置、删除及导入使用同一 Target Key 规则：必须是非空、非纯空白的字符串，长度不超过 2048；有效 Key 原样保留。计数值必须为非负安全整数（`0`～`Number.MAX_SAFE_INTEGER`），也接受仅含数字的字符串；负数、小数、混合文本和超出安全整数范围的值均被拒绝。递增溢出会报错，不写入计数文档。

## 公开接口 (无需认证)

### 1. 获取计数

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

### 2. 增加计数 (自增)

- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "inc",
    "target": "site-pv"
  }
  ```
- **说明**: 受域名白名单限制。

### 3. 批量增加计数

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
- **限制**: `requests` 最多 100 项，每项必须提供合法 `target`，或兼容的 `/classes/Counter/<target>` 形式 `path`。空数组返回 `[]`，不获取写锁。所有项目先校验再写入；任一项目非法或递增溢出，整批失败，不保存部分计数。
- **响应**: `data` 为按请求顺序返回的 `{ target, time }` 数组，`time` 是该次递增后的计数。同一 target 重复出现时依次递增，调用端可以直接使用响应更新显示。

## 管理接口 (需要认证)

需要在 Header 中携带 `Authorization: Bearer <YOUR_TOKEN>`。

### 1. 设置计数器值

- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "set",
    "target": "site-pv",
    "value": 1000
  }
  ```
- **限制**: `value` 遵循上述非负安全整数规则，与导入保持一致，不使用截断解析。

### 2. 删除计数器

- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "delete",
    "target": "site-pv"
  }
  ```

### 3. 获取计数器列表

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
    - `includeSummary`: 布尔值，默认 `false`；为 `true` 时额外返回 `data.summary`，结构与 `summary` 接口一致，始终统计全部计数器。仪表盘列表与概览共用这次读取。
- **响应说明**: `total` 为筛选后的数量，`allTotal` 为全部计数器数量。

### 4. 获取统计概览

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

### 5. 导出所有数据

- **URL**: `POST /api/counter`
- **Body**: `{ "action": "export_all" }`
- **响应**: 包含所有计数器数据和配置的 JSON 对象。

### 6. 导入数据

- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "import_all",
    "data": {
      "counters": {
        "site-pv": 12000,
        "/posts/hello-world/": {
          "time": 256,
          "created_at": 1700000000000,
          "updated_at": 1700086400000
        }
      },
      "allowedDomains": ["https://blog.example.com"]
    }
  }
  ```

**导入校验**：`data.counters` 必须为对象（允许 `{}` 清空）；Key 与计数值遵循上述共同规则，记录形式使用 `time`，可选时间戳 `created_at` / `updated_at` 为非负安全整数。可选 `allowedDomains` 与白名单配置接口使用相同校验及规范化。先完整校验，再在锁内覆盖，写入失败不会因为预先删除而丢失旧计数。计数与域名配置属于两个文档，不提供跨文档事务。

### 7. 配置域名白名单

- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "set_config",
    "allowedDomains": ["https://blog.example.com", "*.example.com"]
  }
  ```

白名单接受 HTTP(S) Origin（例如 `https://blog.example.com`）、子域通配项（例如 `*.example.com`）和 `*`。保存及导入时去掉首尾空白、规范化域名大小写与默认端口并去重；不接受带用户名/密码、非根路径、查询参数或 fragment 的配置。

`*.example.com` 只匹配 `blog.example.com`、`a.blog.example.com` 等子域，不匹配 `example.com`、`evil-example.com` 或 `example.com.evil.test`；精确 Origin 同时匹配协议和端口。空数组或 `*` 允许所有来源，无 `Origin` 的请求保持兼容放行。白名单用于限制浏览器计数来源，不能替代防刷措施或管理接口的 Bearer 鉴权。

读取历史白名单时，无效条目不参与匹配、不阻断其余合法条目，也不会被自动删除；保存配置或通过 `import_all` 导入时仍需修正全部无效条目。

## OIDC 接口

OIDC 相关接口用于单点登录绑定、登录回调和状态管理。

### 1. 发起 OIDC 授权

- **登录**：`GET /api/oidc/login?mode=login`，要求当前 Issuer 已绑定，成功后返回 302。
- **绑定**：`POST /api/oidc/login`，携带 `Authorization: Bearer <YOUR_TOKEN>`，Body 为 `{ "mode": "bind" }`。返回 `{ "code": 0, "data": { "authorizationUrl": "..." } }`，前端再跳转。
- **安全约定**：不再接受 URL 中的管理员 Token。后端保存 5 分钟的 `state` / `nonce` / PKCE verifier 和浏览器随机值的摘要，通过 HttpOnly、Secure、SameSite=Lax Cookie 将回调绑定到发起登录的浏览器。Provider 须支持 HTTPS、OIDC Discovery/JWKS、PKCE S256，以及 `client_secret_basic` 或 `client_secret_post`。
- 同一浏览器同时发起多个 OIDC 流程时，仅最新流程的 Cookie 有效；旧流程需重新发起。

### 2. OIDC 回调

- **URL**: `GET /api/oidc/callback?code=xxx&state=yyy`
- 验证浏览器 Cookie 和配置，唯一消费 state，再携带 PKCE verifier 换码。
- 使用 `jose` 和 Provider JWKS 验证签名及 `iss` / `aud` / `exp` / `iat` / `nonce`；多 audience 时校验 `azp`。仅接受配置的非对称签名算法集合，不回退到未验证的 userinfo。
- `bind` 模式重新确认管理员授权仍有效，并保存身份；`login` 模式匹配 `issuer + sub`。
- 登录成功返回有效期 60 秒的一次性 Session；Session 只保存身份及 Token 摘要，不保存实际管理员 Token。

### 3. 查询 / 解绑 OIDC 状态

- **URL**: `POST /api/oidc/status`
- **Body**:
  ```json
  { "action": "get_status" }
  ```
- **说明**: 查询 OIDC 是否已配置、是否已绑定；解绑需携带 `Authorization: Bearer <YOUR_TOKEN>` 并传入 `{ "action": "unbind" }`。

### 4. 使用 OIDC Session 换取管理 Token

- **URL**: `POST /api/auth`
- **Body**:
  ```json
  {
    "action": "oidc_verify",
    "oidcSession": "<session-id>"
  }
  ```
- **说明**: 前端在 OIDC 回调后自动调用；Session 通过条件创建消费回执保证只能成功交换一次，同时核对当前绑定身份、绑定时间和 Token 摘要。解绑、重新绑定或 Token 变更后，旧 Session 失效。

## Passkey 校验与兼容

- Cloud Functions 使用 `@simplewebauthn/server` 校验注册响应及登录签名，包括 challenge、可信 Origin、RP ID、用户存在/验证标志与签名计数器；注册和登录均要求 `userVerification: required`。
- `POST /api/passkey` 的 `generateAuthenticationOptions` 支持 `data.purpose`，默认 `authentication`；调用 `generateManagementToken` 前须传 `management`，两类 challenge 不能互换。管理 Token 必须由新版本验签生成，并且仅能消费一次。
- 新凭证使用 Base64URL 编码的 COSE 公钥并标记 `publicKeyFormat: "cose"`。旧版存储的 attestationObject 会在验证 RP ID 和 Credential ID 后提取公钥，成功验签后才更新格式；无法解析的旧凭证需通过 Token 登录后重新绑定。
- 升级前进行中的登录/绑定需重新发起；旧版未验证的临时管理凭证不再接受。实际管理员 Token 仅在成功的登录交换中返回，以兼容现有前端 Bearer 鉴权。

## Passkey Challenge 生命周期与清理

- 注册、登录和管理验证各自生成独立、5 分钟有效的 Challenge，以随机 ID 条件创建，不复用或续期。新流程不删除其它流程的 Challenge，也不再设置用户级 `currentChallengeId`；历史字段不参与新流程判定，仅在消费/取消同 ID 时清理匹配的旧引用。
- 验证仍校验用途、Origin、RP ID、签名和签名计数器，并唯一消费对应 Challenge。并行流程互不删除 Challenge；同一凭证的签名计数器读改写在用户锁内执行，乱序到达的较小计数器仍可能被拒绝。重新注册仍替换该用户旧凭证，并发注册按提交顺序串行保存。
- 前端在取消、失败、卸载或 `pagehide` 时，尽力调用 `POST /api/passkey`，Body 为 `{ "action": "cancelChallenge", "data": { "challengeId": "<本次 ID>" } }`。取消仅针对该 ID，可重复调用；ID 为 1～128 位字母、数字、下划线或连字符。取消未过期 Challenge 时仍保留一次性消费回执；已过期原文档可以直接清理。调用端必须持有本次生成响应中的 ID，不能按用户名取消其它流程。
- 前端清理请求使用独立的 5 秒超时，离开页面使用 `keepalive`；不会阻塞下一次重试。生成选项最多等待 15 秒，以便清理取消后迟到的 ID。无法收到 ID、断网或浏览器终止时，仍可能遗留原文档。验证成功不重复取消，验签请求不自动重试。

### 回收过期 Challenge

- **URL**：`POST /api/maintenance/challenges`
- **手动鉴权**：`Authorization: Bearer <管理员 Token>`，复用管理 API 鉴权；Body 可传 `{}`。
- **定时鉴权**：无 `Authorization` 时，接受私有定时配置生成的 `{ "cleanupToken": "<清理专用凭证>" }`，请求体最多 1024 字节。配置密钥缺失、凭证错误或请求体无效均拒绝；带有 `Authorization` 的请求只按管理员鉴权，不回退到定时凭证。
- 请求体限制按原始流字节计算，兼容 Makers 将 `request.body` 包装为已解析 JSON 的运行时行为。
- 调用方不能指定清理前缀、Key 或过期时间。专用凭证仅被此端点接受，不能用于其它管理 API。
- **响应示例**：`{ "code": 0, "data": { "scanned": 100, "deleted": 80, "skipped": 20, "failed": 0, "hasMore": true } }`。

| 字段 | 含义 |
|---|---|
| `scanned` | 本次尝试读取的 Challenge 文档数量 |
| `deleted` | 本次完成删除的过期原文档数量 |
| `skipped` | 未过期、缺失、过期字段无效或不在允许前缀内的条目数量 |
| `failed` | 本次读取、JSON 解析或删除失败的数量；`code: 0` 不代表该值一定为 0 |
| `hasMore` | 是否仍有扫描进度需要继续；为 `true` 时可再次调用同一接口 |

每批最多检查 100 条，仅删除 `passkey/challenges/` 下 `expiresAt` 为有限数字且已过期至少 60 秒的原文档。使用强一致列举与读取，约 10 秒后停止开始新的操作；已开始的存储操作会等待完成，因此这不是强制的 HTTP 超时。进度保存到 `system/maintenance/passkey-challenges.json`，扫描结束后归零，下次调用重新全扫。临时读取或删除失败会保留重试位置；坏 JSON 保留并跳过，下一轮全扫再次检查。

回收与旧 KV 迁移共用不可抢占锁，锁忙时本次失败，稍后重试。回收不删除 `auth/consumed/` 回执、Passkey 凭证、用户数据或其它锁；相关恢复边界见 [Blob 并发与恢复设计](blob-concurrency.md)。

原生定时任务的启用、密钥配置和运行说明见 [原生定时清理](maintenance.md#原生定时清理)。

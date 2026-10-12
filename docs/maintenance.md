# 维护与升级

[返回首页](../README.md) · [部署与配置](deployment.md) · [API 文档](api.md) · [开发与验证](development.md)

## 为什么从 KV 切换到 Blob

早期版本使用 EdgeOne Pages KV 保存计数器、配置和认证信息。KV 的全球同步采用最终一致模型，多节点之间存在同步延迟：刚写入的计数可能暂时无法在后台列表或下一次读取中看到，域名白名单、Token 和 Passkey 状态也可能短暂不一致。

当前主存储使用 Blob，核心读取路径启用强一致模式，绕过边缘缓存读取最新写入。强一致读取不等于原子递增，并发写入仍需互斥。锁等待超时会报错，函数异常终止可能留下锁；当前版本不会自动抢占，完整限制和恢复方法见 [Blob 并发与恢复设计](blob-concurrency.md)。

## Challenge 清理

Passkey 流程会尽力清理取消或失败时产生的 Challenge，但断网、浏览器终止或无法收到 ID 时仍可能遗留文档。管理员可调用 `POST /api/maintenance/challenges` 分批回收过期原文档；鉴权、请求和统计字段见 [API：回收过期 Challenge](api.md#回收过期-challenge)。回收不删除消费回执、Passkey 凭证、用户数据或其它锁。

## 原生定时清理

公开的 [`edgeone.json`](../edgeone.json) 声明任务 `passkey-challenge-cleanup`：北京时间每天 **03:00**（`Asia/Shanghai`）POST 到 `/api/maintenance/challenges`，每次运行一批回收。`hasMore: true` 时由下一次运行续扫，也可以管理员手动继续；每日一批不保证当天清空任意规模的积压。

启用步骤：

1. 在 Makers 项目的目标部署环境中配置 `OPEN_KOUNTER_CLEANUP_SECRET`，使用密码管理器生成至少 32 字符的随机密钥；同一环境的构建与函数运行时必须能读到相同值，建议只为生产环境配置。
2. 使用 `npm run build:makers` 构建并部署。脚本从密钥派生固定清理用途的 HMAC 凭证，仅将凭证写入权限为 `0600`、已被 Git 忽略的 `.edgeone/routes.json` 的 `schedules[].payload`，不写入根 `edgeone.json`、前端资源或日志。
3. 在 Makers 控制台检查任务和执行日志。已通过专用凭证鉴权的执行会输出 `passkey_challenge_cleanup` 统计日志，不输出请求体、密钥或凭证；关注 `failed` 和 `hasMore`，失败后可手动重试或等待后续运行。

原生定时任务使用静态 JSON payload，因此专用凭证是仅允许清理的可重放权限凭证，不是平台调度身份签名。轮换密钥必须重新构建并部署以同步 payload。密钥缺失时，构建产物不注册此任务，保留手动清理并输出停用说明；配置了不足 32 字符的非空密钥则构建失败，避免误用弱密钥。每次 Makers 构建都会重新生成私有 manifest，避免沿用旧凭证。

不要将 `.edgeone/routes.json` 作为静态文件上传或共享。直接上传预构建 `.edgeone` 时，应确保它刚由 `build:makers` 与 Makers 构建流程生成，密钥与目标运行环境一致。原生调度与构建输出约定见 [定时配置](https://pages.edgeone.ai/zh/document/edgeone-json#schedules) 与 [构建输出规范](https://pages.edgeone.ai/zh/document/building-output-configuration)。

## 升级注意事项

从旧版本更新前，建议通过后台导出计数器与域名配置。当前版本保留 `system/counters.json` 的 `2.1` 布局，计数数据无需迁移到新格式。

- **Passkey**：旧凭证在成功验签后转换公钥格式；不可验证时使用 Token 登录后重新绑定。平台内部请求域名与公开域名不同时，设置 `PASSKEY_ORIGIN`。
- **OIDC**：Provider 需支持 PKCE S256。绑定改为带 Bearer 鉴权的 POST，旧的 `?mode=bind&token=...` 调用方式不再接受；后台界面已适配。
- **进行中的登录**：旧版 Challenge、OIDC Session 和未经过新版验签的管理 Token 会被拒绝，重新发起登录或绑定即可。
- **Challenge 回收**：新流程不再互相替换 Challenge。配置 `OPEN_KOUNTER_CLEANUP_SECRET` 并使用 `npm run build:makers` 可启用每日原生回收，手动接口继续可用。混用旧版本部署时，旧版本仍可能删除旧 `currentChallengeId` 指向的流程，应一并升级。消费回执继续保留，不属于自动删除范围。
- **导入数据**：导入是覆盖操作；完整校验后再写入，不预先删除计数文档。多个 Blob 文档之间没有事务。
- **参数校验**：设置计数与导入统一使用非负安全整数，批量递增最多 100 项；不再接受截断后有效的混合文本。历史数据中的非法计数或白名单需修正后再导入，升级不会自动清理或迁移已有数据。
- **遗留锁**：恢复前必须暂停写入并确认所有在途操作已结束，再按[遗留锁恢复步骤](blob-concurrency.md#遗留锁恢复)处理。

旧 KV 导入入口见[旧版 KV 迁移](deployment.md#旧版-kv-迁移)，构建与回归测试方法见[开发与验证](development.md)。

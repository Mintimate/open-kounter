# 开发指南

[返回首页](../README.md) · [API 参考](api.md) · [维护与升级](maintenance.md)

## 主仓库与镜像

开发和 PR 以 [CNB 主仓库](https://cnb.cool/Mintimate/tool-forge/open-kounter) 为准，[GitHub](https://github.com/Mintimate/open-kounter) 是单向同步的 `main` 分支镜像。维护者本地的 `origin` 应指向 CNB，`main` 跟踪 `origin/main`；GitHub 可保留为 `github` remote 供读取对比。

CNB 的 `main` 推送会触发 GitHub 镜像同步与生产部署。镜像只同步 `main`，不执行强推；若两端分叉，同步应失败并人工整合，避免覆盖 GitHub 独有提交。请勿直接向 GitHub 推送或配置反向同步。[CNB 手动部署按钮](deployment.md#cnb-按钮部署) 使用独立事件。

## 目录与职责

完整目录和编码规范见 [AGENTS.md](../AGENTS.md)。以下是常用入口：

| 路径 | 职责 |
|---|---|
| [.cnb.yml](../.cnb.yml) / [.cnb/web_trigger.yml](../.cnb/web_trigger.yml) | CNB 推送同步、自动部署和手动部署按钮 |
| [client/adapter.js](../client/adapter.js) | 兼容 LeanCloud 的访客计数适配器 |
| [cloud-functions/api/](../cloud-functions/api/) | 认证、计数、Passkey、OIDC、初始化与迁移 API |
| [cloud-functions/api/_blobStore.js](../cloud-functions/api/_blobStore.js) | Store 工厂、Key 命名、读写与锁 |
| [edge-functions/legacy-api/](../edge-functions/legacy-api/) | 只读旧 KV 数据的迁移出口 |
| [src/App.vue](../src/App.vue) / [src/views/](../src/views/) | 登录态、主题状态和页面入口 |
| [src/components/](../src/components/) | 登录、仪表盘业务卡片及公共组件 |
| [src/utils/](../src/utils/) | 请求取消、超时、乱序保护和 Passkey 流程 |
| [src/style.css](../src/style.css) / [tailwind.config.js](../tailwind.config.js) | 公共样式与设计 Token |
| [tests/](../tests/) | 认证、存储、前端请求及部署脚本回归 |
| [scripts/build-makers-manifest.mjs](../scripts/build-makers-manifest.mjs) | 生成私有函数路由与定时任务配置 |
| [scripts/deploy-makers.mjs](../scripts/deploy-makers.mjs) | CNB 部署参数校验、Token 脱敏与 CLI 调用 |
| [edgeone.json](../edgeone.json) / [vite.config.js](../vite.config.js) / [package.json](../package.json) | 平台、前端构建配置与项目依赖 |
| [other/](../other/) | README 界面截图 |

## 本地验证与并发边界

```bash
npm ci
npm test
npm run build
```

回归测试使用内存 Blob、本地生成的签名密钥和浏览器请求模拟，覆盖 Passkey、OIDC 完整绑定/登录、重复消费、计数及白名单校验、导入失败、锁竞争、适配器请求合并与 UV 标记、登录故障处理及请求乱序，不连接线上存储。服务端认证库在 Node.js 20 上验证；构建继续使用 `edgeone.json` 配置的 Node.js 22。

Challenge 回归还覆盖并行流程、独立取消、签名计数器不回退、前端迟到 ID 清理、回收分页断点、失败重试、鉴权及迁移互斥。

原生调度回归验证专用凭证的用途隔离、无效请求无写入、私有 manifest 的路由与权限、密钥轮换以及静态产物不含凭证。Makers 完整构建需运行 `npm run build:makers`；密钥缺失时仅验证停用路径，启用路径应在隔离环境使用临时测试密钥验证，不连接线上 Blob。

计数器仍使用 `system/counters.json` 的原有格式。Blob 强一致读取不等于原子递增；锁等待超时会报错，不再自动抢占过期锁。函数异常终止后可能需要维护恢复。完整取舍、恢复步骤及后续方案见 [Blob 并发与恢复设计](blob-concurrency.md)。

仪表盘以一次列表请求加载列表与概览，概览 Top 8 使用有界选择，避免全量排序。列表请求使用取消、序号校验和 15 秒超时，旧响应不会覆盖新结果。

## 文档维护

README 保留项目介绍、快速开始和文档导航；部署、API、维护及开发细节放在对应的 `docs/` 文档中。修改接口、环境变量或目录结构时，按 [文档同步规范](../AGENTS.md#4-代码变更同步文档规范) 更新对应页面，并检查跨文档链接。

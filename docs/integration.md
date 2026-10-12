# 网站接入与 AI 迁移

[返回首页](../README.md) · [部署与配置](deployment.md) · [API 参考](api.md)

## 接入方式

先完成 [Open Kounter 部署](deployment.md)，获得可访问的 HTTPS 服务地址。自行接入可按 [公开计数接口](api.md#公开接口-无需认证) 调用；已有 LeanCloud 计数代码可使用本仓库的 `migrate-to-open-kounter` Skill 辅助迁移。

[客户端适配器](../client/adapter.js) 提供兼容 LeanCloud `AV.Counter` 的接口。UV 去重与请求行为见下文。

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

## 计数与访客去重

统计概览读取 `site-pv` 与 `site-uv` 作为站点累计指标。后端提供计数操作，UV 去重由接入端负责；仓库中的适配器按浏览器本地记录进行 24 小时去重，不代表跨设备的独立用户识别。

适配器将本次需要递增的目标合并为一次 `batch_inc`，使用服务端返回的计数更新显示。同时显示三项统计时，新访客仅需一次递增请求，24 小时内回访另需一次 UV 读取（均不含跨域预检）。统计关闭、DNT 生效或忽略本地访问时只读取，不写 UV 标记；只有服务端确认 UV 递增成功后才保存标记。请求超时为 15 秒，覆盖响应体读取。请求失败不会提前显示 `+1`，递增也不会自动重试；网络中断时服务端可能已经写入，当前接口不提供幂等重试保证。

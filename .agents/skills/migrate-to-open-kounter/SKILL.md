---
name: migrate-to-open-kounter
description: Replace LeanCloud-based website visit counters with a user-deployed Open Kounter instance. Use whenever a user asks to migrate, adapt, audit, or rewrite LeanCloud AV.Counter, LeanCloud visitor statistics, PV/UV, or page-view counting code to Open Kounter, whether or not deployment details were supplied. Enforce the prerequisite gate and refuse project inspection or changes unless an available Open Kounter deployment and its base URL are provided.
---

# Migrate to Open Kounter

Migrate only the target website's LeanCloud counter behavior to the user's own Open Kounter service. Preserve existing counter keys, rendering behavior, privacy controls, and framework conventions.

## Enforce the prerequisite gate

Before inspecting or editing the target project, require:

1. A deployed Open Kounter instance owned or authorized by the user.
2. Its absolute HTTPS base URL, such as `https://counter.example.com`.

Treat a user-supplied base URL that passes the read-only deployment probe as confirmation that the instance is available. Never guess a deployment URL from repository files, account names, or DNS.

If the user says the instance is not deployed, stop and refuse the migration. Explain that replacement code would have no valid backend and ask them to deploy Open Kounter first.

If the user does not provide the base URL, stop before project inspection or edits. Say:

> 无法开始替换：此操作必须连接到你已部署的 Open Kounter 实例，但当前没有可用的服务域名。请先完成部署，并提供形如 `https://counter.example.com` 的 Open Kounter 地址。

If the endpoint cannot be verified, do not edit. Report the sanitized URL and failure reason, then ask for a working deployment URL. Do not ask for an admin token to bypass a failed public endpoint.

## Verify without writing data

Run the bundled read-only probe:

```bash
node <skill-dir>/scripts/verify-deployment.mjs https://counter.example.com
```

When the target website origin is known, also check the returned CORS header:

```bash
node <skill-dir>/scripts/verify-deployment.mjs \
  https://counter.example.com \
  --origin https://www.example.com
```

The probe must pass before edits. It only reads a reserved, non-mutating target; never use `inc` or `batch_inc` as a health check.

The origin option verifies browser CORS accessibility only. It does not verify the increment allowlist because that would require a write; confirm the allowlist separately in the Open Kounter dashboard.

If network access is unavailable, do not assume success. Ask the user to provide the output of the probe or a response from:

```text
GET https://counter.example.com/api/counter?target=__open_kounter_probe__
```

Accept only HTTP 200 JSON with `code: 0`, a numeric `data.time`, and the exact probe target in `data.target`.

## Inspect the target project

After the gate passes:

1. Read repository instructions and identify the build/test commands.
2. Search for `leancloud-storage`, `AV.init`, `AV.Counter`, `AV.Object.extend`, `AV.Query`, `increment('time')`, `leancloud_visitors`, `app_id`, `app_key`, LeanCloud CDN scripts, and theme analytics configuration.
3. Determine whether LeanCloud is used only for counters or also for comments, authentication, storage, or another feature.
4. Identify all counter targets and normalization rules, including site PV, site UV, and page-path counters.
5. Read [references/api-contract.md](references/api-contract.md) before implementing requests.
6. Read [references/migration-patterns.md](references/migration-patterns.md) for behavior-preserving mappings.

Do not remove a LeanCloud dependency, initialization block, or credential if another feature still uses it. Restrict changes to counter-specific code and configuration.

## Implement the replacement

Use the verified base URL as configuration, not as a scattered literal. Follow the target project's existing environment/config conventions. Normalize the base URL once and avoid double slashes.

Replace counter operations as follows:

- Read one counter with `GET /api/counter?target=...`.
- Increment one counter with `POST /api/counter` and `action: "inc"`.
- Prefer one `batch_inc` request when a page view updates multiple targets.
- Determine UV locally using the site's current semantics; Open Kounter does not infer visitors.
- Preserve Do Not Track, local-development exclusions, SPA navigation hooks, path normalization, and displayed values.
- Encode `target` with `encodeURIComponent` in query strings.
- Treat `body.code === 0` as success even though business failures also use HTTP 200.

Never expose or embed an Open Kounter admin token in browser code. Public read/increment endpoints do not need it.

If the deployment uses a domain allowlist, ensure the target website's browser origin is permitted. Ask the user to configure it in the Open Kounter dashboard when needed; do not request or modify management credentials unless the user separately authorizes configuration work.

## Remove obsolete LeanCloud counter configuration

After the Open Kounter path works:

1. Remove counter-only LeanCloud app ID/key/server URL settings and counter-only CDN imports.
2. Remove the LeanCloud package only if no remaining import or feature needs it.
3. Update relevant sample configuration and user-facing setup documentation.
4. Never print, migrate, or commit existing credentials.

## Verify and report

Run the target project's build and relevant tests. Also check:

- no counter code still calls LeanCloud;
- the Open Kounter URL comes from the intended config source;
- counter reads render correctly on zero and nonzero values;
- increments use the original target keys exactly;
- network/business failures degrade without breaking page rendering;
- no admin token or unrelated LeanCloud feature was removed.

Report the verified Open Kounter base URL, files changed, preserved counter semantics, tests run, and any remaining dashboard action such as allowlisting the website origin. Never claim the migration is complete if only instructions or a patch suggestion were produced.

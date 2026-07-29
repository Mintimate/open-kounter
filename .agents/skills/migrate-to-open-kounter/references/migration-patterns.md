# LeanCloud-to-Open-Kounter migration patterns

## Preserve the data model

Inventory the original counter keys before editing. Common keys are:

| Meaning | Typical target |
|---|---|
| Total site page views | `site-pv` |
| Approximate unique visitors | `site-uv` |
| Page views | Normalized `window.location.pathname` |

Do not rename targets during a code migration. Renaming silently starts new counters.

Open Kounter stores a `target` and numeric `time`. It does not reproduce arbitrary LeanCloud classes, ACLs, queries, or object fields.

## Map LeanCloud operations

| LeanCloud pattern | Open Kounter replacement |
|---|---|
| `new AV.Query(Counter).equalTo('url', target).first()` | `GET /api/counter?target=<encoded target>` |
| `counter.increment('time')` then `counter.save()` | `POST` with `{ action: "inc", target }` |
| Several `increment`/`save` calls for one view | One `batch_inc` request |
| `AV.init({ appId, appKey, serverURL })` used only by counters | Remove after migration |
| LeanCloud class/object ID | Do not emulate; use `target` as the stable identifier |

If the site uses LeanCloud for comments, authentication, or data outside the counter class, keep its package, initialization, and credentials for those features.

## Minimal browser client

Adapt this pattern to the target project's module and error conventions:

```js
function createOpenKounterClient(baseUrl) {
  const server = baseUrl.replace(/\/+$/, '')

  async function parse(response) {
    if (!response.ok) {
      throw new Error(`Open Kounter HTTP ${response.status}`)
    }

    const body = await response.json()
    if (body.code !== 0) {
      throw new Error(body.message || 'Open Kounter request failed')
    }
    return body.data
  }

  return {
    async get(target) {
      const response = await fetch(
        `${server}/api/counter?target=${encodeURIComponent(target)}`
      )
      return parse(response)
    },

    async increment(targets) {
      const requests = targets.map((target) => ({ target }))
      if (requests.length === 0) return []

      const response = await fetch(`${server}/api/counter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch_inc', requests })
      })
      return parse(response)
    }
  }
}
```

Do not include an `Authorization` header in this browser client.

## Preserve counting behavior

- Keep the original pathname normalization. A common rule maps `/post/index.html` and `/post/` to the same `/post/` target.
- Keep existing Do Not Track behavior.
- Keep local-host suppression unless the user explicitly wants development traffic counted.
- Keep SPA route-change hooks. A one-time page-load call is insufficient for client-side navigation.
- Keep the existing UV window and storage key when possible. Open Kounter receives the target but does not decide whether a browser is a new visitor.
- Keep display timing consistent. If the UI optimistically shows `current + 1`, do not also render the returned incremented value as another `+ 1`.
- Handle failures locally and leave the rest of the page usable.

## Framework and theme configuration

Prefer the target project's established public configuration mechanism:

- Vite: a validated `VITE_*` public base URL
- Next.js: a validated `NEXT_PUBLIC_*` base URL
- Hexo/theme config: a dedicated `openkounter.server_url`
- Plain HTML: one centralized configuration constant or data attribute

Only public deployment URLs belong in browser configuration. Never place an Open Kounter admin token there.

The Open Kounter repository's `client/adapter.js` targets Hexo Fluid DOM IDs and globals. Reuse its behavior only when those same conventions exist; do not copy it blindly into unrelated sites.

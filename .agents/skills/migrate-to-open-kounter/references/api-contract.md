# Open Kounter counter API contract

Use the user-provided base URL as `BASE_URL`. Remove a trailing slash before appending paths.

## Response rules

- Successful response: `{ "code": 0, "data": ... }`
- Business failure: `{ "code": 1000, "message": "..." }`
- Not found where applicable: `{ "code": 1404, "message": "..." }`
- Cloud Functions normally return HTTP 200 for both business success and failure.
- CORS supports `GET`, `POST`, and `OPTIONS`.
- Check both the HTTP/network result and `body.code`.

## Public browser interfaces

### Read a counter

```http
GET /api/counter?target=site-pv
```

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

A missing counter is a successful read with `time: 0`. Always URL-encode `target`.

### Increment one counter

```http
POST /api/counter
Content-Type: application/json
```

```json
{
  "action": "inc",
  "target": "site-pv"
}
```

Successful `data`:

```json
{
  "time": 101,
  "target": "site-pv"
}
```

### Increment several counters atomically

```http
POST /api/counter
Content-Type: application/json
```

```json
{
  "action": "batch_inc",
  "requests": [
    { "target": "site-pv" },
    { "target": "/posts/hello-world/" }
  ]
}
```

Successful `data`:

```json
[
  { "target": "site-pv", "time": 101 },
  { "target": "/posts/hello-world/", "time": 8 }
]
```

Each request item requires a non-empty `target`. Prefer this interface when the original page view updates more than one counter.

## Origin allowlist

Increment endpoints inspect the browser `Origin` header. An empty Open Kounter allowlist permits all origins. A configured allowlist must permit the target website origin; otherwise the response has `code: 1000` and `message: "Origin not allowed"`.

Configure the allowlist through the Open Kounter dashboard. Exact entries should match browser origins, including scheme and non-default port when present, for example `https://www.example.com`. Wildcard deployment rules may use entries such as `*.example.com`.

Reads are public and are not blocked by the increment allowlist.

## Management interfaces

These interfaces are not needed for ordinary website integration. They require:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Never put this header or token in browser-delivered code.

| Action | Important fields | Purpose |
|---|---|---|
| `set` | `target`, `value` | Set a counter value |
| `delete` | `target` | Delete a counter |
| `list` | `page`, `pageSize` | List counters |
| `get_config` | — | Read the origin allowlist |
| `set_config` | `allowedDomains` | Replace the origin allowlist |
| `export_all` | — | Export counters and configuration |
| `import_all` | `data` | Replace counters from an export |
| `migrate_legacy` | `legacyToken` or `legacyBundle` | Import the legacy Open Kounter store |

Do not invoke management actions as part of a LeanCloud counter code replacement unless the user explicitly asks for the management operation and securely supplies the required authorization at execution time.

## Canonical source

When this skill is used inside the Open Kounter repository, treat these files as authoritative:

- `cloud-functions/api/counter.js` for request behavior
- `cloud-functions/api/_api.js` for response and CORS behavior
- `client/adapter.js` for the repository's Hexo Fluid-specific browser adapter

Re-read them if the local implementation is newer than this reference.

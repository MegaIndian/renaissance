# Hub API (phase 0)

The hub is the one server-side process (`apps/hub`, Fastify). Phase 0 ships the shape of three routes
so the apps can be built against it; phase 2 fills in the intent engine and the request pipeline
(ADR 0007). Every body is JSON. Validation is Zod; a failed parse answers `400` with
`{ "error": "invalid_request", "issues": [...] }` where `issues` is Zod's issue list.

Run it locally with `pnpm --filter hub dev` (port 8787, `.env` loaded if present) and try the lines
below. Browser calls are allowed from `http://localhost:5173` outside production; set
`RENAISSANCE_HUB_CORS_ORIGINS` for anything else.

## `GET /health`

Liveness plus which integrations are configured. Never a value, only presence. `version` is read
from `apps/hub/package.json` beside the built code, so the container reports its real version. This
route is never rate limited (container health checks poll it).

```sh
curl -s http://localhost:8787/health
```

```json
{
  "status": "ok",
  "service": "renaissance-hub",
  "version": "0.0.0",
  "integrations": {
    "environment": "development",
    "host": "0.0.0.0",
    "port": 8787,
    "corsOrigins": 1,
    "rateLimitPerMinute": 120,
    "jellyfin": false,
    "anthropic": false,
    "intentModel": "claude-opus-5-5",
    "enrichmentModel": "claude-haiku-5-5",
    "lidarr": false,
    "slskd": false
  }
}
```

The `integrations` detail moves behind a hub token in phase 2 (ADR 0007, consequences); `status`
stays public for container health checks.

## `POST /ask`

The Ask bar's endpoint (F75, F76). Phase 0 answers `501` with the fixed tool list and no actions.

Request (`AskRequest` in `apps/hub/src/routes/ask.ts`):

| Field      | Type             | Rule                      |
| ---------- | ---------------- | ------------------------- |
| `text`     | string           | required, 1 to 2000 chars |
| `language` | `"en"` or `"gu"` | optional                  |
| `userId`   | string           | optional, non-empty       |

Response (`AskResponse`): `status` (`ok` or `not_implemented`), `message`, `actions[]`
(`tool`, `input`, `summary`, `undoable`; every id in `input` must come from a tool result in the
same call), `tools[]` (the fixed set: `search_library`, `lookup_catalogue`, `play`, `queue`,
`make_playlist`, `request`, `set_rule`, `explain`).

```sh
# 501 with the tool list and no actions
curl -s -X POST http://localhost:8787/ask \
  -H 'content-type: application/json' \
  -d '{"text":"play something calm for cooking","language":"en"}'

# 400: empty text
curl -s -X POST http://localhost:8787/ask -H 'content-type: application/json' -d '{"text":""}'

# 415: a form body (no parser for it; JSON and plain text are parsed, plain text then fails validation with 400)
curl -s -X POST http://localhost:8787/ask -d 'text=hello'

# Browser preflight from the web dev server: 204 with access-control-allow-origin
curl -s -i -X OPTIONS http://localhost:8787/ask \
  -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST'
```

## `GET /requests`

Everything on its way (F61, F63), newest first. Phase 0 keeps them in memory (capped at 500, oldest
dropped) so the list is empty after a restart.

```sh
curl -s http://localhost:8787/requests
# {"items":[]}
```

## `POST /requests`

Add a request. `201` with the stored item.

| Field           | Type                   | Rule                               |
| --------------- | ---------------------- | ---------------------------------- |
| `kind`          | `"track"` or `"album"` | required                           |
| `title`         | string                 | required, 1 to 200 chars           |
| `artist`        | string                 | required, 1 to 200 chars           |
| `album`         | string                 | optional, 1 to 200 chars           |
| `musicBrainzId` | UUID                   | optional                           |
| `requestedBy`   | string                 | optional, 1 to 64 chars, `"local"` |

The item adds `id` (UUID), `status` (`requested`, `finding`, `downloading`, `ready`, `failed`),
`createdAt`, `updatedAt` and, once the pipeline runs, `progress: { done, total }`.

```sh
# 201
curl -s -X POST http://localhost:8787/requests \
  -H 'content-type: application/json' \
  -d '{"kind":"track","title":"Fireman","artist":"Lil Wayne"}'

# 400: artist missing
curl -s -X POST http://localhost:8787/requests \
  -H 'content-type: application/json' -d '{"kind":"track","title":"Fireman"}'

# 400: title over 200 characters
curl -s -X POST http://localhost:8787/requests \
  -H 'content-type: application/json' \
  -d "{\"kind\":\"album\",\"title\":\"$(printf 'x%.0s' $(seq 201))\",\"artist\":\"A\"}"
```

## `GET /requests/:id`

One request, or `404 {"error":"not_found"}`.

```sh
curl -s http://localhost:8787/requests/00000000-0000-0000-0000-000000000000
```

## Rate limit

Every route but `/health` is limited per client address: `RENAISSANCE_HUB_RATE_LIMIT` requests a
minute (default 120; 0 turns it off). Each answer carries `x-ratelimit-limit`,
`x-ratelimit-remaining` and `x-ratelimit-reset`; past the limit the hub answers `429` with
`retry-after` in seconds and `{ "statusCode": 429, "error": "Too Many Requests", "message": "Rate limit exceeded, retry in 1 minute" }`.
Behind a reverse proxy, set Fastify's `trustProxy` when the hub should see the client's address
instead of the proxy's (phase 2, with the hub token).

```sh
# The third call within a minute answers 429 when RENAISSANCE_HUB_RATE_LIMIT=2
for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/requests; done
```

## Errors the framework returns

| Code | When                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 404  | Unknown route, or an id that is not stored                                 |
| 413  | Body over Fastify's 1 MiB default                                          |
| 415  | A content type the hub has no parser for (anything but JSON or plain text) |
| 429  | More requests than the per-address limit in a minute                       |

## Configuration

Environment variables only (`apps/hub/.env.example` lists every one). Nothing is read from a file
except `.env` through Node's own `--env-file-if-exists`. The container image is
`apps/hub/Dockerfile` (multi-stage, `node:22-alpine`, runs as `node`, health check on `/health`).

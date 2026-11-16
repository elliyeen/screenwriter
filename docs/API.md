# API

Base path `/api`. All bodies are JSON. Responses are `application/json` with `Cache-Control: no-store`.
Errors look like `{ "error": "message" }`. Cross-origin writes (an `Origin` that is not this site) get 403.

## Sign in (no session needed)

| Method and path | Body | Result |
|---|---|---|
| `POST /api/auth/request` | `{ email }` | `{ ok: true }`. 400 bad email. 429 too many requests. |
| `POST /api/auth/verify` | `{ email, code }` | `{ ok, email }` and sets the session cookie. 400 on any failure. |
| `POST /api/auth/logout` | none | Ends this session and clears the cookie. |
| `POST /api/auth/logout-all` | none | Ends every session for the account. |

## Everything below needs a signed-in session (otherwise 401)

| Method and path | Who | What |
|---|---|---|
| `GET /api/me` | any | `{ email }` |
| `GET /api/state` | any | Last script and cursor spot for "continue where you left off". |
| `PUT /api/state` | any | Save that state (max 4,000 bytes). |
| `GET /api/scripts` | any | My scripts (including deleted) and scripts shared with me, with `role`, `meta`, `deleted`. |
| `GET /api/scripts/:id` | owner, editor, reviewer | Script text and metadata. Shared scripts add `?owner=<email>`. |
| `PUT /api/scripts/:id` | owner, editor | `{ text, base }`. Creates or updates. 409 if `base` is stale. `?snapshot=1` also saves a version. Max 1,000,000 characters. |
| `PATCH /api/scripts/:id` | owner, editor | `{ status?, meta? }`. Status is one of idea, outline, draft, revision, final. Meta max 2,000 characters. |
| `DELETE /api/scripts/:id` | owner | Soft delete (moves to trash). |
| `POST /api/scripts/:id/restore` | owner | Brings a script back from trash. |
| `POST /api/scripts/:id/snapshot` | owner, editor | Saves a version now. |
| `GET /api/scripts/:id/versions` | any with access | List of versions. |
| `GET /api/scripts/:id/versions/:vid` | any with access | One version's text. |
| `GET /api/scripts/:id/live` | owner, editor, reviewer | WebSocket for live co-writing (reviewers cannot send edits). |
| `GET /api/scripts/:id/shares` | owner | Who has access. |
| `PUT /api/scripts/:id/shares` | owner | `{ email, role }` where role is `editor` or `reviewer`. |
| `DELETE /api/scripts/:id/shares?email=<email>` | owner | Remove a person. |

Script ids match `^[A-Za-z0-9_-]{4,64}$`.

## Live editing messages

Client to server: `{ t: "op", base, p, d, s }` — `base` is the last revision the client saw, `p` the position,
`d` how many characters are removed, `s` the text inserted.

Server to client:
- `{ t: "init", text, rev, updated, role, you }` when you connect
- `{ t: "op", rev, p, d, s, mine }` each ordered edit (`mine` is true for the sender's own edit, as an acknowledgement)
- `{ t: "peers", peers }` who is in the script
- `{ t: "saved", updated }` after the room writes to the database

See [ARCHITECTURE.md](ARCHITECTURE.md#real-time-co-writing).

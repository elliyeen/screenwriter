# Architecture

## Overview

```
Browser (any device)                         Cloudflare
┌──────────────────────────────┐   HTTPS    ┌───────────────────────────────────────────┐
│ public/  (static files)      │──────────▶│ Worker  src/worker.js                     │
│  app.js   UI + sync          │            │   • serves static assets                  │
│  layout.js fountain.js       │            │   • /api/auth/*  sign in (src/auth.js)    │
│  importer.js feedback.js     │  WebSocket │   • /api/*       scripts, versions, shares│
│  pdf.js zip.js folder.js     │◀──────────▶│        │                │                 │
│  ot.js live.js cloud.js      │            │        ▼                ▼                 │
│  sw.js (offline cache)       │            │   D1 (SQLite)    Durable Object per script │
│  localStorage (device copy)  │            │   scripts, versions,   src/room.js        │
└──────────────────────────────┘            │   shares, users,       live text + merge  │
                                            │   sessions, codes      │                  │
                                            │        ▲               ▼ flush            │
                                            │   Cron 09:00 UTC ─▶ R2 bucket (backups)   │
                                            └───────────────────────────────────────────┘
```

There is no build step. The browser loads ES modules directly.

## Front end (`public/`)

| File | Job |
|---|---|
| `js/fountain.js` | Parses Fountain text into elements (scene, action, character, dialogue, parenthetical, transition, and so on). |
| `js/layout.js` | Turns elements into lines on a fixed character grid and paginates (54 lines a page, CONT'D, MORE, orphan control). |
| `js/pdf.js` | Writes a PDF by hand using the standard PDF Courier fonts. No dependency. |
| `js/importer.js` | Reads .docx (own zip reader), .fdx, text, and PDF (pdf.js), then rebuilds Fountain by rules. |
| `js/feedback.js` | "Studio check": finds format problems, and `studioFix` repairs the mechanical ones. Idempotent. |
| `js/ot.js` | Merge logic for live editing (shared with the server). |
| `js/live.js` | WebSocket client for a script room. |
| `js/cloud.js` | API client. Every call returns `{ ok, status, data }`. A 401 raises an `auth-required` event. |
| `js/folder.js` | Optional "save to a folder" using the File System Access API (Chrome and Edge on desktop). |
| `js/zip.js` | Small zip writer for "Download all". |
| `js/app.js` | Library, editor, sync, sign-in screen. |
| `sw.js` | Service worker. Network first, falls back to cache, so the app opens offline. |

**Layout is grid-based, not font-measured.** Every line is built from character columns (10 per inch, 6 lines per
inch). Wraps and page breaks never depend on how a font renders, so a late-loading font cannot change pagination.

## Worker (`src/`)

- `worker.js`: routing, identity, permissions, nightly backup, scheduled cleanup.
- `auth.js`: email one-time-code sign in, sessions, rate limits.
- `room.js`: the `ScriptRoom` Durable Object (one per script).
- `access.js`: optional Cloudflare Access token check (alternative identity source).

**Identity order for each API call:** session cookie, then Cloudflare Access token (if configured), then the
local-only development login (only on localhost).

## Data model (`schema.sql`)

| Table | Purpose |
|---|---|
| `scripts` | One row per script: owner, id, title, text, status, meta (JSON), timestamps, `deleted` flag. |
| `versions` | Save points of a script's text. |
| `shares` | Who else may open a script, and as editor or reviewer. |
| `user_state` | Last script and cursor position, so another device can pick up there. |
| `users` | Accounts (email, created, last login). |
| `login_codes` | One live sign-in code per email (keyed hash only). |
| `sessions` | Sign-in sessions (hash of the token only). |
| `auth_events` | Counters for rate limits. Cleaned daily. |

## Saving and sync

1. Typing is saved to the device first (`localStorage`), so nothing is lost if the network drops.
2. The app pushes changes to `/api/scripts/:id` with the last known `updated` value as `base`.
   If the server copy changed meanwhile it answers 409, and the app keeps the local text as "(my copy)".
3. On start and after reconnecting, the app pulls the list and merges by id.
4. Deleting sets `deleted = 1` (trash). Nothing is hard-deleted by the app.
5. An unedited starter sample is dropped once real scripts arrive from the server.
6. One account per device at a time: signing in as someone else sets the previous account's unsent work aside
   instead of mixing it in.

## Real-time co-writing

Each open script has one Durable Object. Clients send single-splice edits (position, removed length, inserted text)
tagged with the last revision they saw. The room orders edits, transforms each against the ones it missed, applies it,
and broadcasts. Clients keep a shadow copy, send one edit at a time, and merge on reconnect. The room flushes to D1 on
a short delay and writes a version about every 5 minutes. Reviewers can connect but their edits are refused.

## Offline

The service worker caches the app shell and fonts. Edits stay in `localStorage` and sync when the connection returns.
The status line shows "Offline". Browser storage is a cache, not a backup: the cloud copy and nightly backup are the
safety net.

## Backups

A cron trigger at 09:00 UTC writes `daily/YYYY-MM-DD/<owner>.json` to R2 (all scripts, deleted ones included) and
deletes copies older than 30 days. The same job removes expired codes and sessions. See
[DATA-AND-BACKUPS.md](DATA-AND-BACKUPS.md).

## Design decisions

- **No framework, no build step.** Fewer moving parts, easy to audit, loads fast. The cost is a large `app.js`.
- **Rules, not an AI model.** Format and checks are predictable and explainable. Importing messy files is best-effort.
- **Own sign-in instead of Cloudflare Access.** Branded, no user limit, and users own accounts. Access is still supported
  as an alternative identity source.
- **Durable Object per script.** One place that orders edits, which makes merging simple and correct.
- **Soft delete and snapshots everywhere.** The product promise is "never lose a file".

# Data and backups

## Where data lives

| Data | Where | Kept |
|---|---|---|
| Scripts (current text, title, status, meta) | D1 `scripts` | Never hard-deleted by the app. Deleting moves a script to Trash, and it can be restored. |
| Version history | D1 `versions` | Save point about every 5 minutes when text changed, and on request. |
| Sharing | D1 `shares` | Until removed. |
| Accounts and sessions | D1 `users`, `sessions` | Sessions 30 days. |
| Sign-in codes and rate counters | D1 `login_codes`, `auth_events` | 10 minutes, and 24 hours. Cleaned daily. |
| Live editing state | Durable Object (memory plus D1 flush) | Flushed to D1 shortly after each edit. |
| Device copy | Browser `localStorage` | Cleared on sign out once synced. |
| Nightly backup | R2 `daily/YYYY-MM-DD/<owner>.json` | 30 days. |
| Optional folder copy | A folder the user picks (Chrome, Edge) | User controlled. |

## Layers of protection

1. Device copy (works offline).
2. Cloud database with version history and soft delete.
3. Nightly backup in a separate bucket.
4. User-controlled exports: PDF, .fountain, all scripts as .zip, optional folder sync.

## Backup file format

```json
{ "owner": "author@example.com", "day": "2026-11-16",
  "scripts": [ { "id": "...", "title": "...", "text": "...", "status": "draft",
                 "meta": "{...}", "created": 0, "updated": 0, "deleted": 0 } ] }
```

Backups include deleted scripts. They do not include version history (that stays in D1).

## Restore steps

**One script by mistake (still in trash):** Library, Trash, Restore.

**Older text of a script:** open the script, Version History, Restore.

**Whole account or after data loss:**
1. Download `daily/<date>/<owner>.json` from the R2 bucket.
2. Sign in as that user and use the import tool in the browser console, or run a small script that `PUT`s each script
   to `/api/scripts/:id` with `base: 0`. Scripts whose ids already exist need the current `updated` value as `base`.
3. Confirm the count and open a few scripts.

Test a restore before you rely on it, and record the date you tested.

## Retention and privacy

- Backups roll off after 30 days. Deleted scripts remain in backups until then.
- To remove a user completely: delete their rows from `scripts`, `versions`, `shares`, `user_state`, `users`, `sessions`,
  and their files under `daily/*/` in R2.

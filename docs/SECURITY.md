# Security

This document describes what the app protects, how, and what is not yet covered.
To report a problem, see [../SECURITY.md](../SECURITY.md).

## What we protect

1. **Scripts** (the author's unpublished work). Confidentiality and integrity matter most.
2. **Accounts**: email addresses and sign-in sessions.
3. **Availability of work**: authors must not lose files.

## Who we defend against

- A visitor with no account trying to read or change data.
- A signed-in user trying to reach another user's scripts.
- A malicious website trying to act as a signed-in user (cross-site requests).
- Guessing or brute-forcing sign-in codes, and abusing the email sender.
- A stolen database copy or backup file.
- Mistakes: accidental deletes, bad deploys, a lost device.

Not in scope today: a compromised Cloudflare or Resend account, a compromised author device, targeted attacks on a user's email inbox.

## Controls

### Sign in
- Email one-time code, 6 digits, from a cryptographic random source (no modulo bias). No passwords exist to steal.
- A code expires after 10 minutes, works once, and locks after 5 wrong tries.
- Only a keyed hash (HMAC-SHA-256 with `AUTH_SECRET`) of the code is stored. Comparison is constant time.
- Rate limits: 1 code per minute per email, 5 per hour per email, 20 per hour per network address.
- The answer to "send me a code" is the same whether or not the email has an account (no account discovery).
- Sessions are random 256-bit tokens. Only a hash is stored, so a database leak cannot be used to sign in.
- The session cookie is `HttpOnly`, `Secure` (on https), `SameSite=Lax`, valid 30 days.
- "Sign out" ends this device's session. "Sign out on all devices" ends every session for the account.

### Authorization
- Every `/api/*` call (except `/api/auth/*`) needs a valid identity, or it gets 401.
- Scripts are looked up by `(owner, id)`. A caller who is not the owner needs a `shares` row.
- Roles: **owner** (everything), **editor** (read, write, snapshot, live edit), **reviewer** (read only; live edits refused).
- Only the owner can delete, restore, or share.
- Inputs are validated: ids, email format, status values, text size (1,000,000 characters), metadata size (2,000), state size (4,000).
- Database access uses bound parameters only (no string-built SQL).

### Browser protections
- Requests with an `Origin` header that does not match the site are refused for writes and WebSocket upgrades (403).
- `Content-Security-Policy` allows only same-origin scripts, no inline scripts, no objects, no framing, `form-action 'self'`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`, a restrictive `Permissions-Policy` (microphone only for dictation).
- All user text is escaped before it is placed in the page.
- Fonts and libraries are self-hosted. No third-party scripts, fonts, or analytics.

### Data
- Cloudflare encrypts D1 and R2 at rest and TLS protects data in transit.
- Backups are in a separate R2 bucket, kept 30 days.
- Deletes are soft. Version history is kept.
- Signing out clears the device copy once everything is in the cloud. Unsent work is set aside under that account and restored on the next sign in.

### Local development shortcut
`DEV_EMAIL` plus a `dev_user` cookie gives a fake login for tests. The Worker honours it **only** when the request host is
`localhost` or `127.0.0.1`, and it is never set in production. The sign-in code is returned in the API response only when
`DEV_EMAIL` is set and no `RESEND_API_KEY` exists.

## Secrets

| Secret | Where | Notes |
|---|---|---|
| `RESEND_API_KEY` | `wrangler secret put` | Sends sign-in emails. Use a key limited to sending. |
| `AUTH_SECRET` | `wrangler secret put` | 40+ random characters. Changing it signs everyone out and invalidates pending codes. |

Never commit secrets. `.dev.vars` is ignored by git.

## Known gaps and risks

| # | Gap | Impact | Plan |
|---|---|---|---|
| 1 | Scripts are not end-to-end encrypted. Operators with Cloudflare access could read them. | Confidentiality vs. a compromised Cloudflare account | Document; consider optional client-side encryption later |
| 2 | Rate-limit checks are not atomic (a burst of parallel requests could slip a few extra through). | Minor email abuse | Move counters to a Durable Object |
| 3 | Sessions are fixed 30 days, no list of active devices. | Lost device stays signed in until expiry | Add a device list and sliding expiry |
| 4 | Sign-in email depends on one provider (Resend). | Outage blocks new sign-ins (existing sessions keep working) | Add a second provider |
| 5 | Backups contain plain text of all scripts. | Anyone with bucket access reads everything | Restrict bucket access; consider encrypting backups |
| 6 | No audit log (who opened or exported what). | No forensic trail | Add structured event log |
| 7 | CSP allows inline styles (`style-src 'unsafe-inline'`) because the UI sets inline style attributes. | Reduces CSP strength for styles only | Move inline styles to classes |
| 8 | Uploaded files are parsed in the browser by pdf.js and a small zip reader. | A malicious file could crash the tab | Keep pdf.js updated; size limits |
| 9 | No automated dependency or secret scanning yet. | Late discovery of a bad dependency | Enable GitHub Dependabot and secret scanning |
| 10 | Not yet penetration tested. | Unknown issues | Third-party test before wide launch |

## Hardening checklist before inviting outside authors

- [ ] Secrets set, `DEV_EMAIL` not set in the deployed environment
- [ ] Sending domain verified in Resend (SPF, DKIM) and `MAIL_FROM` set
- [ ] R2 bucket is private and access is limited to the Worker
- [ ] HSTS enabled on the domain (Cloudflare: SSL/TLS, Edge Certificates)
- [ ] Cloudflare WAF rate-limiting rule on `/api/auth/*`
- [ ] Backup restore tested once end to end
- [ ] GitHub secret scanning and Dependabot on

# Deployment

You need: a Cloudflare account, a Resend account, Node 20+, and a domain you can add DNS records to
(needed to email people other than yourself).

## 1. One-time setup

```
npm install
npx wrangler login
npx wrangler d1 create screenwriter           # copy the database_id into wrangler.jsonc
npx wrangler r2 bucket create screenwriter-backups
npm run db:remote                             # creates all tables
```

## 2. Email (Resend)

1. In Resend, add your domain and add the DNS records it shows (SPF and DKIM). Wait until it says verified.
2. Create an API key with sending access only.
3. Set the sender in `wrangler.jsonc`: `"MAIL_FROM": "Screenwriter <login@your-domain.com>"`.

Resend's test sender (`onboarding@resend.dev`) only delivers to your own Resend account email. It cannot be used for authors.

## 3. Secrets

```
npx wrangler secret put RESEND_API_KEY        # paste the key
npx wrangler secret put AUTH_SECRET           # paste 40+ random characters
```

Generate a secret with: `openssl rand -base64 48`

## 4. Deploy

```
npx wrangler deploy
```

The app is live at the `workers.dev` address printed at the end. To use your own address, add a custom domain in the
Cloudflare dashboard (Workers, your worker, Settings, Domains and Routes).

## 5. Check it works

- Open the site, enter your email, receive the code, sign in.
- Create a script, reload, confirm it is saved.
- Sign in from a second device and confirm "Continue writing" appears.
- Trigger the backup once and look for the file in R2 (see below).

## Operations

| Task | How |
|---|---|
| Apply a schema change | Edit `schema.sql` (use `CREATE ... IF NOT EXISTS` or write a migration) and run `npm run db:remote`. |
| Run the backup now | Dashboard: Workers, your worker, Triggers, Cron, "Trigger". Then check `daily/<date>/` in the bucket. |
| Rotate `AUTH_SECRET` | `wrangler secret put AUTH_SECRET`. Everyone is signed out. |
| Roll back a bad deploy | Dashboard: Workers, Deployments, roll back. Data is not affected. |
| Watch errors | `npx wrangler tail` |
| Add a second environment | Copy `wrangler.jsonc` with different names for the worker, database, and bucket. |

## Optional: Cloudflare Access

You can put Cloudflare Access in front of the whole site as an extra gate. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in
`wrangler.jsonc`. The Worker then also accepts a valid Access token as identity. It is not needed for normal use.

## Static-only mode

Uploading only `public/` to Cloudflare Pages gives a single-user, browser-only version (no accounts, no sync, no sharing,
no live editing). Everything else needs the Worker.

## Local development

```
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

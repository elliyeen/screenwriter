# Deployment

You need: a Cloudflare account, a Resend account, a GitHub account, and a domain you can add DNS records to
(needed to email people other than yourself). Node 20+ is only needed for the terminal path.

## Easiest path: deploy from GitHub in the Cloudflare dashboard (no terminal)

Every time you push to the repo, Cloudflare rebuilds and deploys the site. The tables are created automatically on first use.

1. **Create the database.** Dashboard, Storage and Databases, D1, Create database, name it `screenwriter`. Copy its **Database ID**.
2. **Create the backup bucket.** Dashboard, R2, Create bucket, name it `screenwriter-backups` (R2 asks you to turn it on the first time).
3. **Put the Database ID in the code.** In GitHub, open `wrangler.jsonc`, replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID, and commit.
4. **Connect the repo.** Dashboard, Workers and Pages, Create, Import a repository, pick this repo. Name the project `screenwriter` (it must match `"name"` in `wrangler.jsonc`). Leave the build command empty. Deploy command: `npx wrangler deploy`. Save and Deploy.
5. **Add the two secrets.** Open the new Worker, Settings, Variables and Secrets, add as **Secret**: `RESEND_API_KEY` (your Resend key) and `AUTH_SECRET` (40+ random characters, for example from `openssl rand -base64 48`). Deploy again if asked.
6. **Check it.** Open `https://<your-worker>.<your-subdomain>.workers.dev/api/health`. You want `{"ok":true,"database":true,"missing":[]}`. Anything listed under `missing` is still to do.
7. **Sign in.** Open the site, enter your email, enter the code. Until your own domain is verified in Resend (next section), only the email on your Resend account receives codes.

## Email (Resend)

1. In Resend, add your domain and add the DNS records it shows (SPF and DKIM). Wait until it says verified.
2. Create an API key with sending access only.
3. Set the sender in `wrangler.jsonc` (edit in GitHub): `"MAIL_FROM": "Screenwriter <login@your-domain.com>"`.

Resend's test sender (`onboarding@resend.dev`) only delivers to your own Resend account email. It cannot be used for authors.

## Alternative: deploy from a terminal

```
npm install
npx wrangler login
npx wrangler d1 create screenwriter           # copy the database_id into wrangler.jsonc
npx wrangler r2 bucket create screenwriter-backups
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put AUTH_SECRET
npx wrangler deploy
```

Tables are created automatically. `npm run db:remote` still works if you want to apply `schema.sql` yourself.

## Operations

| Task | How |
|---|---|
| Apply a schema change | Edit `schema.sql`, run `node scripts/gen-schema.mjs` (rebuilds `src/schema.js`), commit. New tables are created on first use. Changes to existing tables (ALTER) need a migration step. |
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

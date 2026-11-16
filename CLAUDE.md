# Screenwriter 2.0: guide for Claude Code

A rule-based screenwriting web app on Cloudflare (Worker + D1 + Durable Objects + R2). No AI model, no framework, no build step.
Read `README.md`, then `docs/ARCHITECTURE.md` and `docs/SECURITY.md` before changing anything.

## Commands
```
npm install
cp .dev.vars.example .dev.vars
npm run dev                 # http://localhost:8787 (tables are created automatically)
npm test                    # unit tests (Node, no framework)
npx wrangler dev --local --port 8799 --test-scheduled   # terminal 1, then:
npm run test:e2e            # terminal 2: Playwright + axe + screenshot comparison (needs Chrome, `pip install playwright pillow`)
node scripts/gen-schema.mjs # after editing schema.sql
```

## Rules
- Branch from `main`, small changes, tests with every change, docs and CHANGELOG updated in the same change.
- Never weaken or skip a test to get green. Never claim something works unless you ran it. Say what you did not test.
- Visual changes need screenshots at 1440, 1280, 768 and 390 wide, and axe must stay clean.
- Screenplay layout must follow the grid in `public/js/layout.js` (`L`). Do not change formatting rules to suit a font or a look. Standard: Courier 12pt, 1.5" left, cue 3.7", parenthetical 3.1", dialogue 2.5" to 6.0", 54 lines per page.
- Security: bound SQL parameters only, escape all user text before putting it in HTML, no secrets in git, `DEV_EMAIL` only for local use. Changes to sign-in, sessions, permissions or backups need a security note in the PR.
- Never hard-delete user data. Deletes are soft. Keep the device-copy, cloud, nightly-backup layers intact.
- UI text: short, sixth-grade reading level. Style: white background, Inter for the app, Courier Prime for the script, one orange accent (`--accent` in `style.css`).
- No third-party scripts, fonts, or analytics.

## Where things are
`public/js/app.js` UI and sync (large, a candidate for splitting) · `layout.js` pagination · `fountain.js` parser · `importer.js` uploads · `feedback.js` studio check · `ot.js` + `src/room.js` live editing · `src/auth.js` sign in · `src/worker.js` API · `schema.sql` (then run `scripts/gen-schema.mjs`).

## Current priorities
See `docs/ROADMAP.md`. If `docs/internal/HANDOFF.md` exists, read it first.

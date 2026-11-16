# Screenwriter 2.0

A screenwriting web app that runs in any browser, on any device, with nothing to install.
Write, dictate, or upload a script. It is laid out in standard studio format, checked against common
format rules, saved to your account with version history, and can be written by several people at once.
No AI model is used anywhere: formatting and checking are rule-based and run the same every time.

Runs on Cloudflare (Workers, D1, Durable Objects, R2). Plain JavaScript, no build step, no framework.

## Features

| Area | What you get |
|---|---|
| Library | Script tiles, search, filters (Features, TV Series, Short Films, Other), sort, grid or list, details panel, favorites, milestones with progress, trash and restore. Slide-out sidebar. |
| Editor | Distraction-free page. Scene navigator with reorder, element picker, layout options, studio check with one-click fixes, voice dictation. |
| Studio format | Courier 12pt, US Letter, 1.5" left margin, 54 lines per page, cue and dialogue columns, page numbers from page 2, automatic (CONT'D) and (MORE). |
| Import | PDF, Word (.docx), .txt, Final Draft (.fdx), Fountain. Auto-formatted, with a feedback list. |
| Export | PDF, Fountain (.fountain), all scripts as a .zip. |
| Accounts | Sign in with your email and a 6-digit code. No passwords. |
| Co-writing | Share by email (can edit, or can read). Edits merge live. |
| Safety net | Version history (a save point about every 5 minutes), soft delete, nightly backup to separate storage, offline use, optional "save to a folder" on the computer. |
| Everywhere | Installable web app. Picks up where you left off (same script, same spot) on another device. |

## Quick start (local)

```
npm install
cp .dev.vars.example .dev.vars     # local-only sign-in shortcut, see docs/SECURITY.md
npm run db:local
npm run dev                        # http://localhost:8787
npm test
```

In local development the sign-in code is shown by the API instead of being emailed, so no email service is needed.

## Deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short: create a D1 database and an R2 bucket in the Cloudflare dashboard, connect this GitHub repo as a Worker, add two secrets
(`RESEND_API_KEY`, `AUTH_SECRET`), and verify a sending domain with Resend. After that, every push to the repo deploys. `/api/health` tells you what is still missing.

## Documentation

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, storage, real-time editing, offline |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, known gaps |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [docs/API.md](docs/API.md) | Every endpoint, who may call it, limits |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Step-by-step production setup and operations |
| [docs/DATA-AND-BACKUPS.md](docs/DATA-AND-BACKUPS.md) | What is stored where, retention, restore steps |
| [docs/SCREENPLAY-FORMAT.md](docs/SCREENPLAY-FORMAT.md) | Format rules and pagination |
| [docs/TESTING.md](docs/TESTING.md) | Unit, end-to-end, accessibility and visual tests |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is done, next, and not planned |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branches, reviews, how to run checks |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Repository layout

```
public/            the whole front end (served as static files)
  index.html style.css sw.js manifest.webmanifest
  js/              app, layout engine, parser, importer, PDF writer, merge logic, API client
  fonts/           Inter and Courier Prime (self-hosted, SIL OFL licenses included)
  vendor/          pdf.js, used to read uploaded PDFs
src/               the Worker: API, sign-in, Durable Object rooms
schema.sql         database tables
test/              unit tests, browser tests, screenshot baselines
docs/              documentation
```

## Status

Version 0.6. Verified locally with automated unit and browser tests. Not yet verified on Safari or Firefox,
on a real phone, or at scale. See [docs/ROADMAP.md](docs/ROADMAP.md) for known gaps.

## License

No open-source license has been chosen yet, so all rights are reserved by default. Font licenses (SIL Open Font License) are in `public/fonts/`.

# Changelog

## 0.6.1
- Tables are created automatically on first use (no manual database step)
- `/api/health` shows whether the database and secrets are set up
- Sign in refuses to run without `AUTH_SECRET` (no built-in fallback secret on a real site)
- Deployment guide rewritten for deploying from GitHub in the Cloudflare dashboard

## 0.6.0
- Inter (app) and Courier Prime (script) self-hosted, with preload and offline cache
- Library home matches the new design: compact header, slide-out sidebar, orange accent, colored script tiles
- Top menu is Library, Write, Outline (soon), Marketplace (soon); Develop and Share tabs removed
- Content-Security-Policy and more security headers; dev login honoured only on localhost
- Documentation set added

## 0.5.0
- Accounts: sign in with an email code, sessions, sign out everywhere, rate limits
- Per-account isolation on shared devices

## 0.4.0
- New Library home page, trash and restore, offline mode, continue where you left off, folder sync, nightly backup

## 0.3.0
- Studio check and one-click fixes, real-time co-writing, sharing, version history

## 0.2.0
- Import from PDF, Word, text, Final Draft, Fountain

## 0.1.0
- Layout engine, editor, PDF and Fountain export

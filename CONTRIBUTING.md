# Contributing

## Setup
```
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

## Workflow

1. Create a branch from `main`: `feature/<short-name>` or `fix/<short-name>`.
2. Keep changes small and focused. Update docs and the changelog in the same change.
3. Run `npm test` and `npm run test:e2e`. All must pass. Do not weaken a test to make it pass; fix the cause.
4. Open a pull request that says what changed, how you tested it, and what you did not test.
5. A second person reviews before merge. Changes to sign-in, sessions, permissions, or backups need extra care and a security note in the PR.
6. Merge to `main`. Deploy to a staging environment first, then production.

## Style

- Plain JavaScript modules, no build step, no new runtime dependencies without discussion.
- Escape all user text before putting it in the page.
- Use bound parameters for every database query.
- UI text at a sixth-grade reading level, short and clear.
- Keep accessibility: labels, focus order, keyboard use, contrast (WCAG 2 AA).

## Commits

Short imperative first line, details below if needed.

## Never commit

Secrets, `.dev.vars`, real user data, or real scripts. Use the sample or made-up text in tests.

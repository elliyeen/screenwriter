# Testing

## Unit tests (`npm test`)

Plain Node, no test framework. Covers the Fountain parser and layout engine, PDF output, the merge logic for live
editing, the Cloudflare Access token check, and the importers (.docx, .fdx, text, and PDF round trip) plus the studio check.

## Browser tests (`npm run test:e2e`)

Playwright (Python) with Google Chrome, axe-core for accessibility, and screenshot comparison with Pillow.

Run:
```
pip install playwright pillow
npx wrangler dev --local --port 8799 --test-scheduled     # terminal 1
npm run test:e2e                                          # terminal 2
```
Set `CHROME` if Chrome is not at `/usr/bin/google-chrome`, and `APP_URL` for another address.

What it checks (about 95 checks):

- Layout: three columns on desktop, drawers on tablet and phone, no sideways scrolling at 1440, 1280, 768 and 390 wide.
- Look: one accent color on black, white and grey; text-only name (no logo image); Inter for the app and Courier Prime for the page, self-hosted and loaded; Courier Prime 12pt equals 10 characters per inch.
- Library: create, search, filter, sort, grid and list, select, open, keyboard navigation, rename, duplicate, favorite, milestones, export, trash and restore, slide-out sidebar that stays hidden after reload.
- Accounts: sign in with a code, wrong code refused, code works once, lock after 5 tries, rate limit, secure cookie flags, another account cannot see your scripts, cross-site requests refused, sign out ends the session and clears the device copy.
- Continuity: second device continues at the same script and cursor position; offline open, offline edits survive reload and sync when back online.
- Backup: the scheduled job runs and writes backups.
- Folder sync logic and file naming.
- Accessibility: axe-core WCAG 2 A and AA at four screen sizes for the library, editor and sign-in page.
- Visual regression: screenshots compared with `test/baseline/` (a difference above 1% of pixels fails).
- No page or console errors during the whole run (this also catches Content-Security-Policy violations).

### Visual baselines

The first run saves baselines. After an intended design change, delete the matching files in `test/baseline/`, run once to
regenerate, and review the new images before committing them. Cover colors and the details clock are pinned during
screenshots because they vary from run to run.

### Test data

The tests use throwaway accounts and the local development sign-in. They never touch a real deployment unless you set `APP_URL`
to one, which you should not do.

## Not covered yet

Safari and Firefox, real phones and tablets, load and scale testing, penetration testing, and a restore drill from R2.

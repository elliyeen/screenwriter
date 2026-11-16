# Roadmap

## Done (v0.6)

- Studio-format layout engine, PDF and Fountain export
- Import from PDF, Word, text, Final Draft, Fountain, with studio check and one-click fixes
- Library home (tiles, filters, sort, grid and list, details panel, trash and restore, slide-out sidebar)
- Accounts with email one-time code, sessions, sign out everywhere
- Cloud saving with version history, soft delete, nightly backups to separate storage
- Real-time co-writing, sharing as editor or reviewer
- Offline use, installable app, continue where you left off across devices, optional save to folder
- Inter and Courier Prime self-hosted, accessibility and visual regression tests

## Next

| Priority | Item | Notes |
|---|---|---|
| High | Verify on live Cloudflare, Safari, Firefox, and real phones | Not tested yet |
| High | Backup restore drill and a restore tool | Steps are documented, not yet rehearsed |
| High | Security hardening list in [SECURITY.md](SECURITY.md) | Atomic rate limits, device list, backup encryption |
| High | Page-style editor (WYSIWYG): the Write pane is a plain Fountain text box today | Largest gap vs. professional tools |
| High | Format audit against Final Draft output by a professional reader | Sources differ by about 0.1" |
| High | Structure tab: beat sheet, page targets, guided questions | Planned core feature, not built |
| Medium | Embed Courier Prime in exported PDFs | Today the PDF uses standard Courier (same widths) |
| Medium | Collaborator cursors and comments | You see who is present, not where they are |
| Medium | Per-script layout settings | Settings are per device today |
| Medium | Notes and attachments in the details panel | Shown as "Soon" |
| Medium | Outline view | Tab shown as "Soon" |
| Low | Marketplace | Tab shown as "Soon" |
| Low | Notifications | Bell is disabled |
| Low | Scanned PDFs (OCR), old .doc files | Not readable today |
| Low | Split `app.js` into modules | It has grown large |

## Not planned

- AI or LLM features. Formatting and checks stay rule-based.
- Paid plans or billing (undecided).

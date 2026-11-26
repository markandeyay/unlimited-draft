# Progress

## Summary (read this first)

**Live URL: https://unlimited-draft.vercel.app**

Sign in with the Account button (bottom left) or the link in the library sidebar. Only the GitHub account `markandeyay` is accepted.

### NEEDS MARKANDEYA

Nothing is blocking. Optional things only you can decide:

1. **Chrome extension permission.** If you want Claude to drive the live site again later, the Claude in Chrome extension may ask you to allow `unlimited-draft.vercel.app`.
2. **Two files in your Downloads folder** were created during this work and can be deleted: `We_ll Be in Touch (1).pdf` (the WriterDuet export used for measurements) and `Deploy Test - 2026-11-25.pdf` (the live-site export test).
3. **WriterDuet account.** Nothing was typed, renamed, moved or deleted. The "Last saved online" time in WriterDuet moved by a few minutes while menus were being opened; no content changed.
4. **Node processes.** Early in the build one command stopped every running `node.exe` on this PC to free a port. If you had another Node app or dev server running at the time, restart it.
5. **Enter/Tab feel.** The flow table follows the design doc. If any row feels different from WriterDuet, change it in Customize > Editing.

### What works

- Library: unlimited projects, recents, folders (one level of nesting, drag a project onto a folder), sort, full-text search across every script with jump to line.
- Editor: WriterDuet element set and toolbar, Enter/Tab flow, Ctrl+1 to Ctrl+0 element shortcuts, typing rules (INT./EXT., TO:, parenthetical), autocomplete (characters, extensions, scene intros, locations, times, transitions), dual dialogue, move lines, undo and redo, inline bold/italic/underline/strike, text color and highlight, alignment, bullets, page breaks, images.
- Pages: live pagination that matches the PDF line for line, page gaps and numbers, (MORE) and (CONT'D), automatic (CONT'D), scene numbers (with lock and 12A style inserts), page count, dark page, zoom and text size.
- PDF: export with title page, scene numbers, revision asterisks, notes, page range. Quick Export, Preview, Print, Email Document (share sheet or download plus mailto).
- Layout engine verified against a real WriterDuet PDF export: all 10 pages match line for line (row and column).
- Sync: offline first, commits to `markandeyay/unlimited-draft-scripts` (JSON plus a Fountain mirror), batching, empty repo bootstrap, merge when two devices edit, pull from other devices, status indicator, Set External Backups dialog.
- Auth: GitHub OAuth, single allowed login, encrypted HttpOnly cookie, proxy limited to the scripts repo.
- Tools: find and replace with scope, filter, go to, rename character, spell check with suggestions and a personal dictionary, word count, comments panel, cards panel and card view (drag to reorder scenes).
- Reports: statistics, dialogue and non-dialogue filters, character scenes filter, locations and scenes, list of shots, hide shots, hide notes, PDF with notes.
- Revisions: tracking with colors and asterisks, accept/reject, mark and unmark, date and writers, current line history, timeline, snapshots (open, compare, restore).
- Production: scene numbers, headers and footers, mores and continueds, separate scene, omit scene.
- Customize: Editing (flow table), Display, Format, PDF, Page, Misc (commit interval, cache, zip export).
- Import: Final Draft (.fdx), Fountain, PDF scripts (with a type preview you can correct), zip and JSON files.
- Phone layout: library, read-only script with a big Export PDF button, Edit mode with an element picker, one menu sheet.
- PWA: loads and edits with no network.

### What does not work or is thin

- WriterDuet's own backup format (.wdz) was not inspected, so importing it is best effort. Export FDX or Fountain from WriterDuet instead; both import cleanly.
- Date & Writers is a dialog, not a hover tooltip.
- Format > Column is left out (it needs a paid plugin in WriterDuet).
- The page itself (text position, wrapping, spacing) matches WriterDuet pixel for pixel. The chrome around it is close but not identical: icons are Lucide, and the side panel shows full labels where WriterDuet truncates them.
- If two devices edit the same line while both are offline, the newer edit wins and the older text is kept in that line's history rather than shown as a conflict.

### Verification done

- 55 unit tests (layout golden and rules, PDF positions, imports, sync with a fake GitHub, merge).
- 17 Playwright tests (typing flow, typing rules, autocomplete, dual dialogue, pagination, PDF export, title page, dark mode, comments, find and replace, rename character, cards, reports, scene numbers, go to, revisions, snapshots, offline reload, search, folders, Fountain and PDF import, typing speed in a 148 page script at about 4 ms per keystroke, phone layout).
- Live site: signed in with GitHub, created a project, wrote a scene, exported a PDF (positions checked), confirmed the commit `Edit: Deploy Test / Script` in the scripts repo, removed the project and confirmed the commit `Remove: deploy-test-hd5w7y`. The empty repo was bootstrapped by the app (`Initial commit`).

## Milestones

| # | Milestone | State |
|---|---|---|
| 1 | Scaffold | done |
| 2 | Layout engine | done |
| 3 | Editor core | done |
| 4 | Shell UI | done |
| 5 | Local storage | done |
| 6 | PDF export | done |
| 7 | Auth + sync | done, deployed |
| 8 | Editing features | done |
| 9 | Comments and Cards | done |
| 10 | Reports | done |
| 11 | Revisions, history, snapshots | done |
| 12 | Import | done (see .wdz note) |
| 13 | Phone layout | done |
| 14 | Full-text search | done |
| 15 | Polish pass | done (side-by-side with the WriterDuet screenshots: page text, wraps, toolbar, menus, Customize dialog) |

## How to run locally

- `npm install`, then `npm run dev` (app only, no sign in) or `vercel dev` (with the API; needs `.env.local`, see `npm run setup`).
- `npm test` for unit tests, `npm run e2e` for Playwright.

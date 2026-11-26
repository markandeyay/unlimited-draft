# Decisions

Running log of judgment calls made while building. Newest at the bottom.

## 2026-11-25

### Setup

- **Package manager: npm.** The design doc refers to `npm run setup`, so npm is used throughout.
- **Skills and tools.** frontend-design, pdf, Playwright (npm), gh and vercel CLIs were already present. Nothing else needed installing.
- **TypeScript 6, not 7.** typescript-eslint does not support TypeScript 7 yet.

### WriterDuet reference capture

- **Screenshots and the exported PDF are not committed.** They show a private screenplay and WriterDuet's own UI artwork, and this repo is public. They are in `docs/writerduet-reference/` on this machine only (gitignored). `TOKENS.md` in that folder is the committed record of every measurement.
- **The golden pagination fixture is scrambled.** `tests/layout/fixtures/wd-golden.json` was built from the exported PDF by `scripts/make-golden.py`. Every word is replaced by random letters of the same length (same word, same replacement). Line lengths, sentence ends and speaker identity are kept, so the fixture exercises the engine exactly like the real script, without publishing the script.
- **Enter/Tab flow was not typed into WriterDuet.** The flow table follows SYSTEM_DESIGN.md Section 4.2, and WriterDuet's Customize > Editing panel confirmed "Enter/Tab traditional behavior" is on. I did not type into the Private Pad to probe each row, to keep the account strictly untouched. If a row feels different from WriterDuet, change it in Customize > Editing (it is one table in `src/editor/flow.ts`).
- **WriterDuet's own project export format was not downloaded.** The import dialog reads Final Draft (.fdx) and Fountain (both exportable from WriterDuet's free tier), and also opens zip archives (.wdz) and JSON files and looks for a script inside. See "Import" below.

### Geometry (WriterDuet's numbers win over the design doc's starting values)

Measured from the Quick Export PDF, see `TOKENS.md`:

- Character name at 3.5 in (design doc said 3.7). Parenthetical at 3.0 in with the "(" hanging one character left (doc said 3.1).
- Action wraps at 61 characters and dialogue at 35. The PDF shows a 61 character action line that did not wrap, and a 62 character candidate that did.
- Scene headings and Shots have 2 blank lines before them (0 at the top of a page).
- `(MORE)` and `NAME (CONT'D)` are printed in the margins (the line after the last body line, and the line above the first), so they never use one of the 54 body lines.
- Page number is left-anchored at x = 7.5 in, baseline 44.25 pt from the top.
- A dialogue block may split at any element boundary inside it, not only at a sentence end. Inside a single dialogue element a split still needs a sentence end.
- Title page text is centered in a box 400 pt wide starting at the left margin. That reproduces WriterDuet's title, "written by" and author positions to within 1 pt.
- **Scene headings are not bold by default.** The sample script's headings are bold because bold was applied by hand in WriterDuet. Customize > Format can make any line type bold.
- **Transition right edge is 7.5 in** (WriterDuet's screen CSS). The one transition in the sample PDF ("FADE OUT.") ends at 7.03 in, which does not match WriterDuet's own style sheet, so it looks like a per-line margin in that script. The golden test skips the x position of that one row.
- Outline has 1 blank line before it (design doc). WriterDuet's style sheet uses 0.

### Layout engine

- **"Incremental" is done with a wrap cache plus incremental decorations.** Wrapping is cached per line, so after one edit only that line is re-wrapped. The placement pass over the whole script is a few tenths of a millisecond, so it is simply rerun. On screen, only lines whose placement changed get new decorations. Measured in Playwright on a 148 page script: about 4 ms per keystroke (median), 5 ms at the 90th percentile.
- **Line wrapping on screen.** Lines made of plain words are wrapped by the browser (`white-space: pre-wrap`, exact width), which gives the same result as the engine. Lines with other break opportunities (a hyphen or slash inside a word, non-ASCII punctuation) get explicit line breaks from the engine. An end-to-end test checks 400 awkward lines for identical row counts.
- **Text element node name.** ProseMirror reserves the node name `text`, so the Text element is stored in the editor as `general`. The saved JSON still says `text`.
- **Notes, Outline and Sequence lines are hidden from the PDF**, so a script with notes can paginate differently on screen and in the PDF. WriterDuet behaves the same way.
- **A4** keeps the same indents and gets 58 lines per page.

### Editor behavior

- Tab on a non-empty Dialogue line starts a Parenthetical below it. Tab on a non-empty Character adds " (" to start an extension like (V.O.). Tab on a non-empty Parenthetical moves to a new Dialogue line. On other non-empty lines Tab converts the line (typing a name in Action, then Tab, makes it a Character).
- Shift+Tab steps back (Character to Action, Dialogue to Character, and so on).
- Enter on an empty Scene line makes it Action (the design doc says "cycle element menu"; the toolbar and Ctrl+1 to Ctrl+0 cover switching).
- Typing `(` on an empty Dialogue line makes a Parenthetical and inserts the closing `)`.
- Page break (Edit > Insert, Ctrl+Enter) is stored as a flag on the line that starts the new page.
- Omitted scenes show struck through in the editor and print as `OMITTED`.
- Date & Writers is a dialog (current line plus the most recently changed lines), not a hover tooltip. Line timestamps are stamped at save time.
- Format > Column is left out: in WriterDuet it needs the MultiColumn plugin. Format > Document Template lists Screenplay only.
- File > Close Tab returns to the library. Close All Tabs Except Current only shows a notice, because the app has one tab.
- Scene heading display: text is stored as typed and shown uppercase, as the design doc says.

### Storage and sync

- **Dirty keys, not file copies, are queued.** `syncQueue` holds keys like `doc:<id>`; the file content is built from IndexedDB at commit time, so many saves become one commit.
- **Text files are sent inline in the tree request** instead of one blob request per file. A commit is about 5 API requests.
- **Merge without a stored base.** Lines are compared by id. A line changed on one side since the last sync takes that side; changed on both, the newer `updatedAt` wins and the other text goes into the line's `history`. A line found on one side only is kept if it was created or edited after the last sync, otherwise it was deleted on the other side and is dropped.
- **Pull.** On start, when the tab becomes visible, and every 2 minutes, the app compares the repo head with the last head it saw and pulls changes from other devices.
- **Tab close.** The commit is flushed when the tab is hidden (`visibilitychange`). `sendBeacon` is not used because a full script exceeds its 64 KB limit; anything not pushed stays in the queue and goes out on the next open.
- **Local history.** A local copy of each document is kept every few minutes (25 kept) so Current Line's History, Timeline View and snapshots work offline. Commits from the scripts repo are added when signed in.
- **Folders and the spelling dictionary** live in the `settings` table. An extra `snapshots` table holds snapshot contents.

### Security

- The proxy also checks the `Origin` header on writes, and the session cookie is only honored if its login equals `ALLOWED_GITHUB_LOGIN`.
- The app opens without signing in and keeps data in that browser only. Nothing from the scripts repo is reachable without the session cookie.

### Deployment

- Production URL: https://unlimited-draft.vercel.app (Vercel project `unlimited-draft`, connected to the GitHub repo, so every push to main deploys).
- GitHub OAuth App "Unlimited Draft" (GitHub > Settings > Developer settings > OAuth Apps). **"Expire user access tokens" is turned off**, so the session lasts until sign out. With expiring tokens the app would have to rotate a single-use refresh token across several parallel proxy requests, which is fragile for no real gain in a one-person app whose token sits in an encrypted HttpOnly cookie.
- The client secret was copied with GitHub's copy button and piped from the clipboard into `vercel env add`, then the clipboard was cleared. It was never printed, typed into a page or written to a file. `COOKIE_SECRET` was generated with Node's crypto and piped the same way.
- Environment variables are set for Production (as sensitive) and Development.

### Import

- **WriterDuet path used: FDX and Fountain parsers**, as the design doc allows, plus a best-effort reader for zip and JSON files (it looks for .fdx, .fountain or JSON line lists inside). WriterDuet's own backup format was not inspected, to avoid creating or changing anything in the account.
- PDF import classifies by indent relative to the most common left edge, so PDFs from other screenwriting tools also work.

### Reports

- Dialogue, Non-Dialogue and Character Scenes filters show the result on the real page (a filter bar appears above it) and can be exported as a PDF. Statistics, Locations & Scenes and List of Shots open in a dialog and export as a text PDF.
- PDF with notes prints Note lines in place and adds numbered markers for comments with a Comments page at the end.

### Spell check

- The Hunspell dictionary files are copied to `public/dict/` (the npm package only exposes a Node loader). Character names and ALL CAPS words are not flagged.

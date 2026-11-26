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
- WriterDuet's export formats were inspected later, when the three projects were imported. See "Import" below.

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

### Screen metrics

- **The page on screen uses WriterDuet's letter-spacing (-0.3 px).** A glyph advances 9.2938 px while indents stay on the 0.1 in grid, exactly like WriterDuet. Left-aligned boxes are sized to hold their character count at that advance, so the browser wraps where the engine does. The PDF is unaffected: it draws at 7.2 pt per character.
- Centered and right-aligned lines, dual dialogue names and the title page always take their line breaks from the engine, because their boxes are sized for alignment, not for character count.
- Toolbar height is 51 px so the page starts at the same y as in WriterDuet.
- Toolbar and rail icons are Lucide, plus three small drawn glyphs (a solid 3 by 3 grid for Cards, a bold "A" for Text, a bold "!" for Note) where Lucide has nothing close. No WriterDuet artwork is used.

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

- **WriterDuet path used: WriterDuet's JSON export** (File > Export > File Type: JSON). It was inspected on 2026-11-25. It lists every line with its type, text, bold/italic/underline ranges, alignment, a page marker on the first line of each page, and the title page lines. The importer maps it directly and carries the title page over. Importing the three existing scripts gave the same page starts WriterDuet reports.
- **.wdz backups are also read, with a caveat.** A .wdz is a zip with `script.json` (project info plus an edit log) and one checkpoint file per document. The importer reads the checkpoint (lines keyed by a sortable id, control characters 1 and 2 around bold text). Edits made after the last checkpoint exist only in the edit log, which is not replayed, so the import dialog warns when it sees any. One of the three projects had no checkpoint at all. Prefer the JSON export.
- FDX and Fountain parsers remain for files from other tools.
- PDF import classifies by indent relative to the most common left edge, so PDFs from other screenwriting tools also work.

### Reports

- Dialogue, Non-Dialogue and Character Scenes filters show the result on the real page (a filter bar appears above it) and can be exported as a PDF. Statistics, Locations & Scenes and List of Shots open in a dialog and export as a text PDF.
- PDF with notes prints Note lines in place and adds numbered markers for comments with a Comments page at the end.

### Spell check

- The Hunspell dictionary files are copied to `public/dict/` (the npm package only exposes a Node loader). Character names and ALL CAPS words are not flagged.

## 2026-11-25, small details pass

Observed in WriterDuet (hovering, opening menus, collapsing and re-expanding one scene, widening and restoring the side panel; no script content was changed) and added:

- **Collapse arrow beside a scene heading.** 28 px left of the heading text, shown when the heading is hovered or holds the cursor, and always shown while collapsed. A collapsed scene keeps its heading and hides everything up to the next heading; the page count on screen follows what is visible. Collapsed state is a view preference kept in this browser (`localStorage`), not in the script, so it never reaches the PDF or the scripts repo. If the cursor is inside a scene when it collapses, it moves to the heading.
- **Hovered line band** (`rgba(175,180,43,0.06)`, fainter than the current line) and WriterDuet's blue selection color.
- **Comment button in the left margin** that follows the hovered line. Clicking it puts the cursor on that line, opens the Comments panel and focuses the box.
- **White tooltips** on the element toolbar (what each line type is for, in my own words) and on the rail (for example "Cards & Private Pad").
- **Cards:** an expand arrow per card that shows the whole scene, the scene holding the cursor in white with the rest grey, a per-card menu (Jump to card, Focus on card, Copy, Cut, Paste, Duplicate, Remove), a panel menu (Show card previews, Expand all, Collapse all), sequence headings between groups, and a Private Pad row at the bottom.
- **Project menu** reordered like WriterDuet's (Duplicate, Rename, Project Settings, Delete). **Every document row** has an options menu (Open, Rename, Copy to New Project, Delete) and a tooltip with its name and last edit time. "Open" shows its Ctrl+O hint when the panel is wide.

Left out on purpose: Open in Split Pane, Default View, Make Document Public, Move to Folder (documents), Share Project, Color/add tags and Filter on cards, Show tags, card Dark mode, Group by Act. These belong to collaboration, tagging or features the design doc drops.

Not copied because it could not be seen without typing in the account: the line type picker that WriterDuet shows after Enter on an empty line.

# Unlimited Draft: System Design

Version 1.0, November 25, 2026
Owner: Markandeya Yalamanchi

This is the single source of truth for building Unlimited Draft. Read all of it before writing code. When something here conflicts with a guess or a convention, this document wins. When something is not covered, copy what WriterDuet does (Appendix A) and note the decision in `docs/DECISIONS.md`.

---

## 1. What we are building

Unlimited Draft is a personal screenwriting web app that copies WriterDuet's free tier as closely as possible (layout, menus, toolbar, sidebar, page, behavior), with these differences:

- **No limit on scripts.** WriterDuet's free tier allows three projects. Unlimited Draft allows any number.
- **Solo only.** No collaborators, chat, ReadThrough or real-time co-editing.
- **Some paid WriterDuet features are included** (Section 9).
- **Some free WriterDuet features are dropped** (Section 10).
- **Scripts are stored in a private GitHub repo** owned by Markandeya, not on someone else's server.

It is used by one person: Markandeya. It must be accessible from any browser, including a phone.

### 1.1 Repositories

| Repo | Visibility | Purpose |
|---|---|---|
| `markandeyay/unlimited-draft` | Public | All app code. Deployed to Vercel. |
| `markandeyay/unlimited-draft-scripts` | Private | All scripts and project data. Written only by the app. |

The scripts repo may be completely empty (no commits). The app must handle that by creating the first commit itself (Section 6.5).

### 1.2 Branding and copying rules

Copy WriterDuet's layout, structure, menu organization, element types, keyboard behavior and visual proportions. Do **not** copy WriterDuet's name, logo, icon artwork, or any of their source code or image assets. Use an open icon set (Lucide) chosen to look as close as possible to WriterDuet's icons. The app name shown in the UI is **Unlimited Draft**. The "Upgrade to Pro" button does not exist.

---

## 2. Tech stack and why

| Concern | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript, built with Vite | Fast, standard, Markandeya knows React. No SSR needed. |
| Hosting | Vercel (static SPA + a few serverless functions in `/api`) | Free, deploys on push. |
| Editor engine | ProseMirror (directly, not through TipTap) | Full control over a custom schema where every node is a screenplay element, plus keymaps, input rules and decorations. TipTap adds abstraction we would fight. |
| Pagination | Custom layout engine (Section 5) | Courier Prime is monospaced, so line wrapping and page breaks can be computed exactly by character counts. The same engine feeds the screen and the PDF, so they always match. |
| PDF export | `pdf-lib` with embedded Courier Prime TTF | Draws text at exact positions from the layout engine. Output is pixel-identical to the on-screen pages. |
| PDF import | `pdfjs-dist` | Extracts text with x/y positions, which lets us classify elements by indent. |
| Local storage | IndexedDB via `Dexie` | Offline-first: every edit lands locally first. |
| Sync | GitHub REST API (Git Data endpoints) via `@octokit/rest` | Commits straight to the private repo. |
| Auth | GitHub OAuth App + Vercel serverless functions | Only Markandeya's GitHub account can sign in (Section 7). |
| Search | `minisearch` | Full-text search across all scripts in the browser. |
| Spell check | `nspell` + an English Hunspell dictionary, run in a Web Worker | Works offline, underlines misspellings, suggestions in a context menu. |
| State | Zustand | Simple store for UI state outside the editor. |
| Styling | CSS Modules with CSS variables for light/dark themes | Exact control to match WriterDuet. |
| Tests | Vitest (unit), Playwright (end to end) | Pagination needs heavy unit tests. |
| Offline shell | `vite-plugin-pwa` | The app loads with no network. |

---

## 3. Data model

### 3.1 Concepts

- **Project**: what WriterDuet calls a project. Has a name, a folder in the library, and one or more **documents**.
- **Document**: an editable page stack. Every new project starts with three documents, matching WriterDuet:
  1. **Script** (WriterDuet's "Default Document"), the screenplay.
  2. **Private Pad**, free-form notes using the same editor in "Text" style.
  3. **Title Page**, a single freeform page (Section 8.6).
  More documents can be added with "Add Document".
- **Line**: one element in a document (a scene heading, an action paragraph, a dialogue block line and so on). Every line has a stable unique ID that never changes, which is what makes line history, revisions, comments and scene numbers work.

### 3.2 Element types

Exactly WriterDuet's toolbar set:

`scene`, `action`, `character`, `parenthetical`, `dialogue`, `transition`, `shot`, `text`, `note`, `outline`, `newAct`, `endAct`, `lyrics`, `image`, `sequence`

Dual dialogue is not an element. It is a grouping: two consecutive character blocks marked `dual: "left"` and `dual: "right"`.

### 3.3 Canonical document format

Canonical storage is **JSON**, not Fountain. The planning notes said Fountain plus a sidecar file. That was changed here because Fountain cannot represent stable line IDs, notes, lyrics, images, acts, sequences, revision marks or line history without a sidecar that has to stay in sync line by line, which is fragile. Markandeya said readability on GitHub does not matter, only in the app, so JSON is the safer choice. A `.fountain` mirror is still written next to each script on every commit so the repo stays human-readable.

```ts
interface DocumentFile {
  schema: 1;
  id: string;                 // ulid
  projectId: string;
  kind: "script" | "pad" | "titlePage" | "custom";
  name: string;
  settings: DocumentSettings; // Section 11, per-document overrides
  lines: Line[];
  titlePage?: TitlePageBlock[];   // only when kind === "titlePage"
  sceneNumbers: { enabled: boolean; locked: boolean };
  revision: RevisionState;    // Section 9.2
}

interface Line {
  id: string;                 // ulid, never reused
  type: ElementType;
  text: string;               // plain text
  marks?: InlineMark[];       // bold, italic, underline, strike, color, highlight ranges
  dual?: "left" | "right";
  sceneNumber?: string;       // "12", "12A"
  omitted?: boolean;          // Omit Scene
  revisionColor?: string;     // set when changed under revision tracking
  revisionMarked?: boolean;   // asterisk in the margin
  imageRef?: string;          // for image lines: path to file in repo
  createdAt: string;
  updatedAt: string;
}

interface InlineMark {
  from: number; to: number;
  kind: "bold" | "italic" | "underline" | "strike" | "color" | "highlight";
  value?: string;
}
```

### 3.4 Scripts repo layout

```
unlimited-draft-scripts/
  README.md
  library.json                       // index: projects, folders, recents, for fast loading
  projects/
    <project-slug>-<shortid>/
      project.json                   // name, folder, created/updated, document order
      documents/
        <docId>.json                 // canonical DocumentFile
        <docId>.fountain             // read-only mirror, regenerated on every commit
      comments/<docId>.json          // comments anchored to line IDs
      assets/<imageId>.<ext>         // images placed in scripts
      snapshots.json                 // named snapshots -> commit SHA
```

```ts
interface LibraryFile {
  schema: 1;
  folders: { id: string; name: string; parentId?: string }[];
  projects: { id: string; path: string; name: string; folderId?: string;
              pageCount: number; updatedAt: string; openedAt?: string }[];
}
```

`library.json` is a cache for the home screen. If it is missing or corrupt, rebuild it by listing `projects/`.

### 3.5 Local database (IndexedDB)

Tables: `projects`, `documents`, `comments`, `assets`, `syncQueue`, `settings`, `searchIndex`, `historyCache`.

IndexedDB is the working copy. The editor never waits on the network.

---

## 4. Editor

### 4.1 Schema

A ProseMirror schema with one block node per element type. Each node has attrs `{ id, dual, sceneNumber, omitted, revisionColor, revisionMarked }`. Inline marks: bold, italic, underline, strike, textColor, highlight. The doc node contains only element nodes, never raw paragraphs.

A plugin assigns a new ulid to every node that lacks one and keeps IDs stable through splits (the left half keeps the old ID, the right half gets a new one) and merges (the surviving node keeps its ID).

### 4.2 Element flow (Enter and Tab)

Copy WriterDuet's behavior. The defaults are:

| Current element | Enter (on non-empty line) | Enter (on empty line) | Tab |
|---|---|---|---|
| Scene | Action | cycle element menu | Action |
| Action | Action | Character | Character |
| Character | Dialogue | Action | Transition |
| Parenthetical | Dialogue | Dialogue | Dialogue |
| Dialogue | Character | Action | Parenthetical |
| Transition | Scene | Scene | Scene |
| Shot | Action | Action | Action |
| Text, Note, Lyrics | same type | Action | Action |

Before shipping, open WriterDuet (Appendix A lists the menus) and confirm each row. Any difference: follow WriterDuet and record it in `docs/DECISIONS.md`. The flow table lives in one config file (`src/editor/flow.ts`) so it is easy to adjust.

Typing rules:
- A line typed as Action that starts with `INT.`, `EXT.`, `INT./EXT.`, `I/E` converts to Scene.
- A line ending in `TO:` in Action converts to Transition.
- Scene, Character and Transition display in uppercase (stored as typed, rendered and exported uppercase).
- Typing `(` at the start of a Dialogue line turns it into a Parenthetical.

### 4.3 Element toolbar

The row above the page, in this order, each with an icon above a label exactly like WriterDuet: **Scene, Action, Character, Parens, Dialogue, Transition, Shot, Text, Note, Outline, New Act, End Act, Lyrics, Image, Sequence, Dual**. Clicking one converts the current line (or inserts, for New Act, End Act, Image). The active element is highlighted blue. A small caret on the left collapses the toolbar.

### 4.4 Autocomplete

Copy WriterDuet's autocomplete. A dropdown appears under the caret while typing:
- **Character**: names already used in the project, most frequent first, plus extensions after a space and `(`: `(V.O.)`, `(O.S.)`, `(O.C.)`, `(CONT'D)`.
- **Scene**: intros `INT.`, `EXT.`, `INT./EXT.`, `I/E`, then locations already used, then after ` - ` the times `DAY`, `NIGHT`, `MORNING`, `EVENING`, `CONTINUOUS`, `LATER`, `MOMENTS LATER`, plus any used before.
- **Transition**: `CUT TO:`, `FADE IN:`, `FADE OUT.`, `DISSOLVE TO:`, `SMASH CUT TO:`, `MATCH CUT TO:`, plus any used before.

Up/Down moves, Enter or Tab accepts, Escape closes.

### 4.5 Keyboard shortcuts

All shortcuts use Ctrl on Windows/Linux and Cmd on Mac. From the WriterDuet menus:

| Action | Shortcut |
|---|---|
| Open Project | Ctrl+O |
| Save Project (forces sync now) | Ctrl+S |
| Set External Backups | Ctrl+Shift+S |
| Print | Ctrl+P |
| Undo / Redo | Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z) |
| Move Selection Up / Down | Alt+Up / Alt+Down |
| Find | Ctrl+F |
| Go To | Ctrl+G |
| Dual Dialogue / Exit Dual | Ctrl+D / Ctrl+E |
| Full Screen | Ctrl+Shift+F |
| Bold / Italic / Underline | Ctrl+B / Ctrl+I / Ctrl+U |

WriterDuet also has element shortcuts (switching the current line's type from the keyboard). Look them up in WriterDuet's Customize > Editing panel and help docs and copy them exactly. Keep all shortcuts in `src/editor/keymap.ts`.

### 4.6 Other editing behavior

- Current line highlighted with a pale yellow band, like WriterDuet.
- Move Selection Up/Down moves whole lines.
- Edit > Insert submenu: page break, scene, image, act break, sequence.
- Format > Text Style, Text Color, Text Highlight, Text Alignment, Bullets apply inline marks or line attrs.
- Rename Character (Tools): renames every Character line and every mention in Action and Dialogue, with a preview count before applying.
- Find (Ctrl+F) with Replace, match case, whole word, and scope (all, dialogue only, action only). Filter (Edit > Filter) shows only lines of chosen types or characters.
- Go To (Ctrl+G): jump to page number or scene number.

---

## 5. Pagination and formatting engine

This is the most important part of the app. The screen and the PDF both come from this one engine, so they always match.

### 5.1 Page geometry

US Letter, 8.5 x 11 in. Font: Courier Prime 12 pt. At 12 pt Courier, there are exactly **10 characters per inch** and **6 lines per inch**.

- Top margin 1.0 in, bottom margin 1.0 in, so the body is 9.0 in = **54 lines** per page.
- Page number: top right, 0.5 in from the top, right edge at 7.5 in, format `12.` (no number on page 1, matching WriterDuet's default).

Element indents (measured from the left edge of the paper) and widths:

| Element | Left | Width (in) | Max chars/line | Space before |
|---|---|---|---|---|
| Scene | 1.5 | 6.0 | 60 | 1 blank line (2 for scenes after the first, if WriterDuet does) |
| Action | 1.5 | 6.0 | 60 | 1 |
| Character | 3.7 | 3.3 | 33 | 1 |
| Parenthetical | 3.1 | 2.0 | 20 | 0 |
| Dialogue | 2.5 | 3.5 | 35 | 0 |
| Transition | right aligned to 7.5 | 2.0 | 20 | 1 |
| Shot | 1.5 | 6.0 | 60 | 1 |
| Text | 1.5 | 6.0 | 60 | 1 |
| Lyrics | 2.5 | 3.5 | 35 | 0, italic |
| Note | 1.5 | 6.0 | 60 | 1, shown highlighted, never printed unless "PDF with notes" |
| Outline, Sequence | 1.5 | 6.0 | 60 | 1, bold, hidden from PDF by default |
| New Act / End Act | centered | 6.0 | 60 | 2, underlined, act starts a new page |
| Dual dialogue | left column 1.5 to 4.25, right 4.5 to 7.25 | about 2.6 each | 26 | per column |

These are industry standard values. **Before finalizing, export a test script from WriterDuet as PDF and measure its indents and lines per page. Where WriterDuet differs, use WriterDuet's numbers.** Store all of this in one config, `src/layout/geometry.ts`, so the whole app follows it.

### 5.2 Line wrapping

Because the font is monospaced, wrapping is pure string math: break on the last space before the max chars; hard-break words longer than the line. Uppercase transforms apply before measuring. No DOM measuring.

### 5.3 Page breaking rules

Walk the elements in order, placing wrapped lines on pages. Rules (industry standard, matching WriterDuet's Production > Mores & Continueds defaults):

1. A **scene heading** never sits as the last thing on a page. It must have at least 2 lines of the following element with it, or it moves to the next page.
2. A **character name** never ends a page. It moves with its dialogue.
3. A **parenthetical** never ends a page.
4. **Dialogue** that does not fit may split across pages only at a sentence boundary, with at least 2 lines on each side. At the bottom put `(MORE)` at the character indent. At the top of the next page repeat `CHARACTER (CONT'D)`. If no good sentence break exists, move the whole block.
5. **Action** may split between sentences with at least 2 lines on each side, else moves whole.
6. A **transition** never starts a page alone; it pulls the line before it onto the next page.
7. Optional (Production > Mores & Continueds): `(CONTINUED)` at the bottom and `CONTINUED:` at the top when a scene crosses a page. Default off, like WriterDuet.
8. **Automatic (CONT'D):** when the same character speaks again in the same scene with only action between, add ` (CONT'D)` after the name in display and export. Setting to turn it off.
9. Dual dialogue blocks are laid out side by side and never split.
10. Manual page breaks (Edit > Insert) are honored.

The engine output is a list of pages, each a list of positioned lines `{ x, y, text, style, lineId }`. The editor overlays page boundaries using this output (Section 8.3). The engine must be incremental: re-layout from the edited page onward, not the whole script, so typing stays fast on a 120-page script. Target under 16 ms per keystroke.

### 5.4 Scene numbers

Production > Scene Numbers: on/off, shown left at 0.75 in and right at 7.4 in (setting for left, right or both), starting number, and lock. When locked, new scenes between 12 and 13 get `12A`, `12B`. Omit Scene replaces the scene with `OMITTED` but keeps its number.

### 5.5 Headers and footers

Production > Headers & Footers: left, center and right text for header and footer, with tokens `{page}`, `{title}`, `{date}`, `{draft}`. Default: page number top right only.

---

## 6. Storage and sync

### 6.1 Principle

Offline-first. Every edit writes to IndexedDB immediately. A sync engine pushes to GitHub in the background. The user never waits for GitHub.

### 6.2 Save and commit timing

Markandeya chose auto commit and push on every save. To stay under GitHub's API rate limit (5,000 requests/hour) and avoid thousands of tiny commits:

- A **save** happens after 3 seconds of no typing, on Ctrl+S, on switching documents, and on closing the tab.
- Saves are batched into **one commit at most every 30 seconds** while writing, and immediately on Ctrl+S, Save Snapshot or tab close (using `navigator.sendBeacon` or a `visibilitychange` flush).
- Commit message format: `Edit: <Project name> / <Document name>`; snapshots use `Snapshot: <name>`.

### 6.3 Commit mechanics

Use the Git Data API to write several files in one commit:
1. GET the branch ref (`main`) for the head SHA.
2. Create blobs for each changed file (document JSON, fountain mirror, library.json, comments).
3. Create a tree based on the head tree.
4. Create a commit with that tree and the head as parent.
5. Update the ref. If it fails with a non-fast-forward error (a commit from another device), fetch, merge (Section 6.4) and retry.

### 6.4 Conflicts between devices

Only one person uses the app, but they may edit on a laptop and a phone. On a non-fast-forward:
- Fetch the remote document. Merge line by line using line IDs: lines changed only on one side take that side; lines changed on both sides take the newer `updatedAt` and keep the other version in the line's history.
- If a whole document was deleted on one side and edited on the other, keep it.
- Show a small notice: "Merged changes from another device."

### 6.5 Empty repo bootstrap

If the scripts repo has no commits (GitHub returns 409 "Git Repository is empty"), create the first commit with the Contents API (`PUT /repos/{owner}/{repo}/contents/README.md`), then continue with the Git Data API.

### 6.6 Status indicator

Bottom of the Project panel, like WriterDuet: "Last saved online: 7:13 PM" and "Last saved offline: 7:13 PM", with a green check when in sync, a spinner while pushing, and an orange dot when offline with pending changes.

### 6.7 Set External Backups

The File menu item opens a dialog showing the connected scripts repo name, the last commit time and link, and a "Sync now" button. It replaces WriterDuet's Google Drive/Dropbox backup.

---

## 7. Authentication and security

- A **GitHub OAuth App** (not a GitHub App) with callback `https://<vercel-domain>/api/auth/callback`. Scope: `repo` (needed for private repo access).
- Serverless functions in `/api`:
  - `GET /api/auth/login`: redirects to GitHub with a random `state` stored in a short-lived cookie.
  - `GET /api/auth/callback`: checks `state`, exchanges the code for a token, calls `GET /user`, and **rejects any login that is not `ALLOWED_GITHUB_LOGIN`** (env var, set to `markandeyay`). Stores the token in an encrypted, `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
  - `GET /api/auth/me`, `POST /api/auth/logout`.
  - `ALL /api/github/*`: a thin proxy that attaches the token from the cookie and forwards to `api.github.com`, only for paths under `/repos/markandeyay/unlimited-draft-scripts/` and `/user`. The token never reaches browser JavaScript.
- Offline: the app opens from the PWA cache and IndexedDB without auth, but sync waits until the cookie is valid again. Because only data in that browser is visible offline, this is acceptable.
- Env vars (Vercel): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_GITHUB_LOGIN`, `SCRIPTS_REPO` (`markandeyay/unlimited-draft-scripts`), `COOKIE_SECRET`.
- **Setup helper:** include `scripts/setup.html` (a local page, run with `npm run setup`) where Markandeya pastes the OAuth Client ID and Secret. It writes `.env.local` and prints the exact `vercel env add` commands, so nothing is set up by hand. `.env*` files are in `.gitignore`. The app repo is public, so never commit secrets.

---

## 8. UI specification (copy WriterDuet)

### 8.1 Overall layout (desktop)

```
+----+--------------+-------------------------------------------------------------+
|    |              |   ^  File Edit Format Share View Tools Reports Revisions     |
| R  |  Second      |      Production Customize Help (?)                           |
| A  |  panel       |   +-----------------------------------------------------+   |
| I  |  (changes    |   | ^ Scene Action Character Parens Dialogue ...  Dual  |   |
| L  |  with rail)  |   +-----------------------------------------------------+   |
|    |              |   |                                                     |   |
|    |              |   |            white US Letter page                     |   |
|    |              |   |                                                     |   |
| Acc|  save status |   | 1 of 10                                             |   |
+----+--------------+-------------------------------------------------------------+
```

- **Icon rail** (about 60 px, darkest navy): back arrow at top, then Project, Cards, Comments, Analysis, Tools (icon above label), Account avatar at the bottom.
- **Second panel** (about 105 px, slate blue, collapsible): content depends on the rail item (8.2).
- **Workspace**: dark navy background. The menu bar sits centered above the page. The element toolbar is attached to the top of the page area. The page is white with a soft shadow. Page counter `1 of 10` bottom left of the viewport. "Navigate to title page" pill button top right of the page.
- Match WriterDuet's colors closely (sample from screenshots; starting values: rail `#232e3c`, panel `#3a4a5c`, workspace `#1b2533`, menu text `#e6e9ee`, accent blue `#1e7bd6`, current-line highlight `#f6f6e4`).
- **Dark Mode** (View > Dark Mode) darkens the page to a dark grey with light text, like WriterDuet. The default is the light page.

### 8.2 Rail panels

- **Project**: project name with a menu (rename, duplicate, remove); "Project Documents" list with icons (Script, Private Pad, Title Page, custom docs); "+ Add Document"; then Import, Export, Quick Export (PDF), New Project, Open, Set External Backups; then the save status (6.6).
- **Cards**: a grid of cards, one per scene, showing scene heading and first lines; click jumps to the scene; drag to reorder scenes; "+ New Sequence" adds a sequence divider. Card View in the View menu shows the same grid full width.
- **Comments**: comments on the current document, newest first, each anchored to a line ID; click jumps to the line; add, edit, resolve, delete. Highlight the commented text in the script. No Chat section.
- **Analysis**: Document Stats, Check Spelling, Word Count, Locations, Dialogue (the reports in Section 9.1 open from here as well as the Reports menu). No Goals section.
- **Tools**: Bold, Italic, Underline, Strikethrough, Undo, Redo as a vertical list; then a Revisions section with the revision tools from Section 9.2.
- **Account**: GitHub avatar and login, theme toggle, sign out, link to the scripts repo.

### 8.3 Page view

The editor is one continuous ProseMirror document. Page boundaries come from the layout engine and are drawn as decorations: a gap between white pages, the page number, `(MORE)` and `CHARACTER (CONT'D)` as non-editable widgets, and scene numbers in the margins. View > Page Breaks off shows a continuous page. View > Page Count toggles the counter. View > Text Size and Page Zoom scale the page.

### 8.4 Menus

Copy every menu from Appendix A in the same order, with these changes:
- Items in Section 10 (dropped) are removed, not greyed out.
- Pro/Premium badges are removed; the paid features we include (Section 9) work normally.
- **Share** menu contains only **Email Document**: export the PDF, then open the device share sheet (Web Share API with the file) or, if unsupported, download the PDF and open a `mailto:` with the subject filled in.
- No "Upgrade to Pro" button.

### 8.5 Home screen (library)

Shown at `/` when no project is open and from the rail's back arrow.
- Left: **Recents**, **All Projects**, then folders (create, rename, delete, nest one level, drag projects into folders).
- Main: a grid of project cards: title, page count, last edited, folder. Sort by last edited (default), name, created.
- Top: search box with **full-text search across every script**, showing matching projects and line snippets; clicking a snippet opens the project at that line.
- "New Project" button. Unlimited projects.

### 8.6 Title page

Exactly like WriterDuet: a separate freeform page reached by "Navigate to title page", with a bar at the bottom: "You're editing the title page" and a "Navigate to the script" button. It is a normal editable page (Text style) where text can be centered, left or right aligned.

New projects get this default title page:
- Title, centered, uppercase, about one third down the page.
- Blank line, `written by`, blank line, author name (from settings, default "Markandeya Yalamanchi"), centered.
- Bottom left contact block: address, phone, email (values from Customize > PDF settings, each optional, empty by default).
- Optional bottom right: draft name and date.

The title page is page 0 in the PDF and is not counted in page numbers.

### 8.7 Phone layout (width under 768 px)

Priority is **downloading and exporting PDFs**.
- Library works fully.
- Opening a project shows the script read-only with a bottom bar: Export PDF (big primary button), Edit, Documents, Search.
- Edit mode allows small edits: a compact element picker replaces the toolbar, menus collapse into one sheet.
- Export PDF on the phone uses the Web Share API so the PDF can be saved to Files, AirDropped or emailed.

---

## 9. Paid WriterDuet features included

### 9.1 Reports

All open in a side sheet or new tab and can be exported to PDF:
- **Document Statistics**: pages, scenes, words, characters, dialogue vs action percentage, lines per character, scenes per location, estimated runtime (1 page = 1 minute).
- **Dialogue Filter / Non-Dialogue Filter**: show only dialogue (optionally for chosen characters) or only non-dialogue, in page format.
- **Locations & Scenes**: every location with its scenes, page numbers, INT/EXT and time of day.
- **Character Scenes Filter**: pick characters, see only scenes they appear in.
- **List of Shots**: every Shot element with page and scene. Also "Hide All Shots" toggle.
- **PDF with notes**: PDF export that includes Note elements and comments as margin notes. Also "Hide Inline Notes" toggle.

### 9.2 Revisions

Revision tracking, matching WriterDuet's Revisions menu:
- **View & Track**: turn on tracking with a revision color (standard order: White, Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry). While on, every changed or added line gets `revisionColor` and `revisionMarked`, shown as a colored text tint and an asterisk in the right margin (asterisks also print in the PDF).
- **Accept/Reject**: step through tracked changes; accept clears the marks, reject restores the line from the revision base (stored when tracking started).
- **Mark Change / Unmark Change**: manually add or remove the asterisk on selected lines.
- **Date & Writers**: on hover, show when each line was last changed (writer is always Markandeya, so show date and device).

### 9.3 History and snapshots

Backed by the scripts repo's git history plus a local cache:
- **Current Line's History**: every past version of the line under the cursor, newest first, with timestamps; click to restore. Built by walking commits that touched the document and diffing by line ID. Cache results in IndexedDB.
- **Timeline View**: a slider across all commits of the document; dragging shows the script as it was; "Restore this version" makes a new commit with that content.
- **Save Snapshot**: name a version; creates a commit and records it in `snapshots.json`.
- **Document Snapshots** (submenu): list snapshots; open read-only, compare with current (side-by-side diff by line ID), or restore.

---

## 10. Dropped features (do not build)

Mind Map View, Outliner, Pins, Graveyard, Line Alternates, Tagger, Show Tags, Goals and Goal Tracking, Writing Schedule, ScreenplayProof (AI), Dictate, ReadAloud, AutoTranslate, Add/Remove Collaborators, Send to ReadThrough, Chat, Typewriter Mode, Ruler, Read-Only mode, Check Formatting, Shorten Document, Present Progressive, Watermarks, Lock Pages, Lock Line Numbers, Duplicate Document (Duplicate Project stays), Custom report, Notifications settings, Interface/Document Language (English only).

---

## 11. Customize (settings)

Keep the WriterDuet Customize menu structure, solo-relevant items only:
- **Editing**: element flow table (Enter/Tab per element), autocomplete on/off, auto-capitalize, smart quotes, automatic (CONT'D) on/off.
- **Display**: light/dark mode, current-line highlight, page shadow, show page breaks, show page count, text size.
- **Format**: per-element font style, indents, spacing before, uppercase (defaults from Section 5.1). "Reset to WriterDuet defaults".
- **PDF**: include title page, author name, contact block (address, phone, email), draft name and date, scene numbers left/right/both, revision asterisks on/off, include notes.
- **Page**: paper US Letter (A4 available but off by default), margins, page number position, first page numbered or not.
- **Misc**: commit interval, scripts repo name (read-only), clear local cache, export everything as a zip.

Settings are stored in `settings` in IndexedDB and mirrored to `settings.json` in the scripts repo so they follow Markandeya across devices.

---

## 12. Import and export

### 12.1 Export

**PDF only** (File > Export, Quick Export (PDF), Print).
- Generated with `pdf-lib` from the layout engine output; embed Courier Prime (Regular, Bold, Italic, Bold Italic, from Google Fonts, OFL license, committed in `public/fonts/`).
- Options dialog: include title page, scene numbers, revision asterisks, notes (PDF with notes), page range.
- File name: `<Title> - <Draft or date>.pdf`.
- Print opens the PDF in a new tab and calls print.

### 12.2 Import

File > Import accepts:
- **WriterDuet files.** WriterDuet's own project export format must be inspected first (export one from Markandeya's account and look inside it). If it is readable (zip or JSON), map its elements directly. If it is not, import WriterDuet's other export formats instead (Final Draft `.fdx`, Fountain), which WriterDuet free tier can export: an `.fdx` parser (XML, `Paragraph Type="..."`) and a Fountain parser cover every WriterDuet script either way. Record which path was used in `docs/DECISIONS.md`.
- **PDF scripts.** Use `pdfjs-dist` to read text items with x/y positions. Group into lines by y, classify by left x against the indents in 5.1 (with tolerance), detect page numbers, `(MORE)` and `(CONT'D)` and drop them, join wrapped lines back into elements. Show a preview with each line's detected type before importing, so wrong guesses can be fixed with the element toolbar.
- Every import creates a new project.

---

## 13. Project structure (app repo)

```
unlimited-draft/
  SYSTEM_DESIGN.md
  CLAUDE.md
  README.md
  docs/DECISIONS.md
  api/                      # Vercel serverless functions (auth, github proxy)
  public/fonts/             # Courier Prime TTFs
  scripts/setup.html        # local page to paste OAuth credentials
  src/
    app/                    # routes, shell, providers
    ui/                     # rail, panels, menus, toolbar, dialogs, library
    editor/                 # ProseMirror schema, plugins, keymap, flow, autocomplete
    layout/                 # geometry, wrapping, pagination (pure TS, no DOM)
    pdf/                    # export (pdf-lib), import (pdfjs)
    import/                 # fdx, fountain, writerduet parsers
    storage/                # Dexie db, models
    sync/                   # GitHub client, commit queue, merge
    reports/
    revisions/
    history/
    search/
    spell/                  # worker + dictionary
    settings/
  tests/
    layout/                 # golden pagination tests
    e2e/                    # Playwright
```

`src/layout` must stay pure TypeScript with no DOM or React imports so it can be unit tested and shared by screen and PDF.

---

## 14. Testing

- **Pagination golden tests**: a set of sample scripts (short, feature length, heavy dialogue, dual dialogue, long action) with expected page breaks. Write at least one by exporting the same text from WriterDuet and recording where each page breaks, and assert the engine matches.
- **PDF tests**: export, re-read with pdfjs, assert text positions match the layout engine.
- **Import tests**: round-trip export PDF then import PDF and compare element types.
- **Sync tests**: mock GitHub; test empty repo bootstrap, batching, non-fast-forward merge.
- **E2E (Playwright)**: create project, type a scene with Enter/Tab flow, autocomplete a character, dual dialogue, add comment, export PDF, reload offline and keep editing.
- Performance: typing in a 120-page script stays under 16 ms per keystroke.

---

## 15. Build order

Build in this order. Each milestone ends with tests passing and a commit.

1. **Scaffold**: Vite + React + TS, lint, Vitest, Playwright, PWA, Vercel config, fonts, `CLAUDE.md`, `docs/DECISIONS.md`.
2. **Layout engine**: geometry, wrapping, pagination rules, golden tests. (No UI yet.)
3. **Editor core**: schema, line IDs, element flow, typing rules, element toolbar, page view with layout decorations, MORE/CONT'D.
4. **Shell UI**: rail, panels, menu bar with every menu wired (dropped items removed), dark mode, matching WriterDuet's look.
5. **Local storage**: Dexie, projects, documents, library home screen, folders, recents.
6. **PDF export**: identical to the screen; title page; options.
7. **Auth + sync**: OAuth functions, setup page, GitHub proxy, commit queue, empty repo bootstrap, status indicator, merge.
8. **Editing features**: autocomplete, find/replace, filter, go to, rename character, spell check, word count, inline formatting, scene numbers, headers/footers, omit/separate scene.
9. **Comments and Cards panels.**
10. **Reports.**
11. **Revisions, history, snapshots.**
12. **Import**: WriterDuet, PDF.
13. **Phone layout.**
14. **Full-text search.**
15. **Polish pass**: side-by-side comparison with WriterDuet screenshots, fix every visual difference.

---

## 16. Setup checklist for Markandeya

Things only Markandeya can do (Claude Code should pause and ask at each one, with exact click-by-click steps):

1. Repos exist: `unlimited-draft` (public), `unlimited-draft-scripts` (private). Done.
2. Create a GitHub OAuth App (GitHub > Settings > Developer settings > OAuth Apps > New). Homepage URL and callback URL come from step 3.
3. Import `unlimited-draft` into Vercel (one click from vercel.com/new).
4. Run `npm run setup`, paste the OAuth Client ID and Secret into the page; it writes `.env.local` and gives the commands to push env vars to Vercel.
5. Sign in on the deployed site with GitHub.

---

## Appendix A: WriterDuet free tier reference

Catalogued from Markandeya's WriterDuet account on November 25, 2026. Items marked PRO, PLUS or PREMIUM are paid in WriterDuet. Section 9 and 10 say which we build.

### Layout
- Far-left icon rail: Project, Cards, Comments, Analysis, Tools, Account (bottom)
- Second panel (changes with the rail). Project panel: project name, Project Documents list (Default Document, Private Pad, Title Page), Add Document, then Import, Export, Quick Export (PDF), New Project, Open, Set External Backups, and "Last saved online / offline" times
- Top menu bar: File, Edit, Format, Share, View, Tools, Reports, Revisions, Production, Customize, Help, Upgrade button
- Element toolbar above the page (collapsible): Scene, Action, Character, Parens, Dialogue, Transition, Shot, Text, Note, Outline, New Act, End Act, Lyrics, Image, Sequence, Dual
- White page on dark navy background, current line highlighted, page counter bottom left ("1 of 10")
- Title page is its own freeform page; "Navigate to title page" button top right of the script; bar on it reads "You're editing the title page" with "Navigate to the script"

### File
New Project, Open Project (Ctrl+O), Open Recent, Save Project (Ctrl+S), Set External Backups (Ctrl+Shift+S), Rename Project, Duplicate Project, Remove Project, Import, Export, Quick Export (PDF), Preview, Print (Ctrl+P), Close Tab, Close All Tabs Except Current

### Edit
Undo (Ctrl+Z), Redo (Ctrl+Y), Move Selection Up (Alt+Up), Move Selection Down (Alt+Down), Insert (submenu), Select All, Find (Ctrl+F), Filter, Go To (Ctrl+G), Dictate (Ctrl+Shift+D)

### Format
Line Type (submenu), Dual Dialogue (Ctrl+D), Exit Dual (Ctrl+E), Document Template, Column, Margins, Read-Only (PRO), Font Settings, Text Style, Text Color, Text Highlight, Text Alignment, Bullets

### Share
Add/Remove Collaborators, Send to ReadThrough, Email Document (PRO)

### View
Page View, Card View, Mind Map View, Full Screen (Ctrl+Shift+F), Typewriter Mode (PRO), Dark Mode, Page Breaks, Page Count, Show Outline, Show Tags, Ruler (PRO), Text Size, Page Zoom, Customize Layout

### Tools
ScreenplayProof (AI proofreading), Outliner, Pins, Line Alternates, Graveyard, Comments, Spelling & Grammar, Tagger (Ctrl+Alt+T), ReadAloud (PREMIUM), AutoTranslate (PREMIUM), Writing Schedule, Rename Character, Present Progressive (PRO), Shorten Document (PRO), Check Formatting (PRO), Word Count

### Reports (all PRO in WriterDuet)
Document Statistics, PDF w/notes, Dialogue Filter, Non-Dialogue Filter, List of Shots, Hide All Shots, Hide Inline Notes, Locations & Scenes, Character Scenes Filter, Custom

### Revisions
Current Line's History (PREMIUM), View & Track (PRO), Accept/Reject (PRO), Date & Writers (PREMIUM), Mark Change (PRO), Unmark Change (PRO), Timeline View (PREMIUM), Duplicate Document (PLUS), Save Snapshot (PREMIUM), Document Snapshots

### Production
Scene Numbers, Headers & Footers, Mores & Continueds, Watermarks (PRO), Lock Pages (PRO), Lock Line Numbers (PRO), Separate Scene, Omit Scene

### Customize
Editing, Display, Format, Notifications, PDF, Page, Misc, Interface Language, Document Language

### Side panels
- Cards: card grid with New Sequence
- Comments: comments on the document, Chat at the bottom
- Analysis: Document Stats (PRO), Check Spelling, Check Formatting (PRO), Present Progressive (PRO), Word Count, Locations (PRO), Dialogue (PRO), Goals with Enable Goal Tracking
- Tools: Bold, Italic, Underline, Strikethrough, Undo, Redo, Tagger and more, plus a Revisions section

### Defaults confirmed from WriterDuet's help docs
- All projects and documents default to 12 pt Courier Prime.
- Paper: US Letter (8.5 x 11 in).

# WriterDuet reference tokens

Captured 2026-11-25 from the live app (computed styles through the DOM) and from a Quick Export PDF of one script. Look only: nothing in the account was edited.

Screenshots and the exported PDF in this folder are kept local only (gitignored), because they show a private script and WriterDuet's own UI artwork. This file is the committed record.

## Colors

| Token | Value | Where |
|---|---|---|
| workspace | `#17232e` (rgb 23,35,46) | body and area behind the page, also the gap between pages |
| rail | `#2c3b48` | 60 px icon rail buttons |
| panel | `#394b59` | second panel |
| menu popup | `#334451` | dropdown menus |
| dialog | `#2c3b48` | Customize dialog, header strip slightly lighter |
| accent blue | `#137cbd` | active toolbar element, primary buttons |
| muted text | `#a2b4c2` | default UI text |
| rail label active | `#ffffff` | |
| rail label idle | `rgba(255,255,255,0.5)` | |
| panel section title | `rgba(255,255,255,0.5)` bold 12 px | "Project Documents" |
| toolbar idle icon/label | `#74818b` | |
| page | `#ffffff`, text `#000000` | |
| current line | `rgba(175,180,43,0.15)` | pale yellow band, radius 4 px |
| title-page pill | `#aca99c`, white text, radius 8 px, shadow `0 2px 2px rgba(0,0,0,.1)` | "Navigate to title page" |
| title-page bottom bar | cream, about `#f6f3e2` | "You're editing the title page." |
| divider | `#808080` 1 px at low opacity | |
| outline/sequence line bg | `#e5e5e5` | |
| note text | black at 50% | |

## Fonts

- UI: "Source Sans Pro", Helvetica, Arial, sans-serif. Rail labels use "Open Sans" 10 px weight 500.
- Menu bar items: 12 px, white, padding 0 9 px, bar height 36 px.
- Menu popup items: 12 px white, row 220 x 30 px, left padding 22 px, popup padding 5 px, radius 0 0 3px 3px, shadow `0 0 4px rgba(16,22,26,.4), 0 8px 24px rgba(16,22,26,.4)`. Shortcuts right aligned. Submenu arrow on the right.
- Toolbar labels: 10 px weight 200, icon above label; each button 48 x 39 px, radius 4 px; toolbar 816 x 49 px, white, padding 4 px 0.
- Panel rows: 12 px white, row 105 x 36 px, padding 4 px 16 px, icon then label.
- Page text: Courier Prime 16 px (12 pt), line-height 16 px. **letter-spacing: -0.3px**, so a glyph advances 9.2938 px on screen (measured with a DOM range: 60 characters = 557.63 px). Indents stay on the 9.6 px (0.1 in) grid. This is why the 576 px action box holds 61 characters, the 331 px dialogue box 35, the 360 px character box 38 and the 240 px parenthetical box 25.
- Page counter: 10 px, `#a2b4c2` on workspace color, padding 3 5 3 0, bottom left of the page column.

## Layout (CSS px at 100% zoom)

- Icon rail: 60 px wide, buttons 60 x 60, first button starts at y 28 (collapse arrow above it). Account button pinned at bottom.
- Second panel: 105 px wide (rail + panel = 165 px). Header row about 36 px with a collapse caret and a kebab menu.
- Menu bar: centered over the page, 816 px wide, top 5 px, height 36 px. Collapse caret at its left. Help "?" circle, a divider, then the upgrade button (not copied).
- Element toolbar: 816 px wide, 50.5 px tall, starts at y 45, attached to the page top, collapse caret at left.
- Page: 816 x 1056 px (8.5 x 11 in at 96 dpi). Padding top 96, left 144, right 96. Gap between pages 20 px in workspace color.
- Page number on screen: 48 px below the page top, right side.
- Customize dialog: 500 px wide, radius 5 px, tab strip on top (Editing, Display, Format, Notifications, PDF, Page, Misc), close X top right.
- The back arrow at the top of the rail collapses the whole sidebar (it does not open the library).

## Screen element geometry (px from page left)

| Element | Left | Width | Margin top | Notes |
|---|---|---|---|---|
| Scene | 144 | 576 | 32 (two blank lines), 0 when first on page | uppercase |
| Action | 144 | 576 | 16 | |
| Character | 336 | 360 | 16 | uppercase |
| Dialogue | 240 | 331 | 0 | |
| Parenthetical | 288 | 240 | 0 | text-indent -1ch (the "(" hangs left) |
| Transition | 144 | 576 | 16 | text-align right |
| Shot | 144 | 576 | 32 | |
| Text | 144 | 576 | 0 | |
| Note | 144 | 576 | 16 | 50% opacity |
| New Act / End Act | 144 | 576 | 16 | centered |
| Outline | 144 | 576 | 0 | grey background |
| Sequence | 144 | 576 | 16 | grey background |
| Dual dialogue | two columns | | | names centered, paren margin 22/18 px |

## PDF measurements (Quick Export, US Letter 612 x 792 pt)

- Font: Courier Prime 12 pt (Regular and Bold embedded). Glyph advance 7.2 pt, line pitch 12 pt.
- First body baseline y = 80.25 pt, so the first line box starts at 72 pt (1.0 in) and the baseline sits 8.25 pt into the 12 pt line.
- Last body baseline y = 716.25 pt. **54 body lines per page.**
- `(MORE)` is printed on line 55 (baseline 728.25), in the bottom margin, at the character indent. `NAME (CONT'D)` on the next page is printed on the line above the body (baseline 68.25), in the top margin. Neither uses a body line. The space before `(CONT'D)` is a non-breaking space.
- Page number: baseline 44.25 pt (line box top at 0.5 in), **left edge at x = 540 pt (7.5 in)**, format `2.`. No number on page 1. Title page is not numbered and not counted.
- Indents (left x): Scene, Action, Shot, Text 108 pt (1.5 in). Character 252 pt (3.5 in). Dialogue 180 pt (2.5 in). Parenthetical 208.8 pt (3.0 in minus one character for the hanging "("). Transition right edge 506.06 pt.
- Max characters per line seen: Action 61, Dialogue 35.
- Space before: Scene 2 blank lines (0 at top of page), Action 1, Character 1, Transition 1, Dialogue and Parenthetical 0, Text 0.
- Automatic `(CONT'D)` appears when the same character speaks again with only action between, including across a page break.
- A dialogue block made of several lines split between two lines that was not a sentence end (each line was its own element), so element boundaries count as split points.
- Title page: title baseline 284.25 pt, "written by" 332.25, author 368.25, all centered on x = 306 pt.

## Behavior (Customize > Editing, defaults observed)

- Enter/Tab traditional behavior: on. Ctrl+number traditional order: on. Enter adds default Character: on.
- Show line type select on enter: on. Auto-capitalization: on. Display suggestions: on.
- Line type defaults, all on: Parenthetical when you enter "(" on certain lines. Scene when you start most lines with "INT." or "EXT.". Transition when you finish most lines with "TO:". Character when you write just a character's name. Dialogue when you finish a Character line with ":".
- Element shortcuts (Format > Line Type): Ctrl+1 Scene, Ctrl+2 Action, Ctrl+3 Character, Ctrl+4 Parens, Ctrl+5 Dialogue, Ctrl+6 Transition, Ctrl+7 Shot, Ctrl+8 Text, Ctrl+9 Note, Ctrl+0 Outline. New Act, End Act, Lyrics, Image, Sequence have none.
- Edit > Insert: Pagebreak (Ctrl+Enter), Hyperlink (Ctrl+Shift+K), Image.
- Customize > Page: headers on (`{REVISION}`, center), footers on (center), header margins left 1.25 in, right 1.25 in, top 0.5 in. Show page numbers on, show page 1 number off. Page size US Letter. Line spacing Normal. Page splitting: split dialogue on, split action lines on, split at sentences on. MORE text `(MORE)`, next page `(CONT'D)`, add CONT'D for consecutive dialogue on, scene continued top and bottom off.
- Customize > Format: Document font Courier Prime. Page margins left 1.50, right 1.00, top 1.00, bottom 1.00 in. Per line type: bold, italic, underline, color, alignment, lines before (0 to 3 in halves).
- Customize > PDF: print document in color on, basic title page on.
- Title page toolbar: Text, Note, Image, Title, Author, Address, Phone, E-mail, Copyright, Outline.

## Menus as observed

- File: New Project, Open Project (Ctrl+O), Open Recent >, | Save Project (Ctrl+S), Set External Backups... (Ctrl+Shift+S), Rename Project..., Duplicate Project..., Remove Project..., | Import..., Export..., Quick Export (PDF), Preview, Print (Ctrl+P), | Close Tab, Close All Tabs Except Current
- Edit: Undo, Redo, Move Selection Up, Move Selection Down, | Insert >, | Select All (Ctrl+A), | Find... (Ctrl+F), Filter..., Go To... (Ctrl+G), | Dictate
- Format: Line Type >, Dual Dialogue (Ctrl+D), Exit Dual (Ctrl+E), | Document Template >, | Column >, Margins >, Read-Only, | Font Settings, Text Style >, Text Color >, Text Highlight >, Text Alignment >, Bullets >
- View: Page View, Card View, Mind Map View, | Full Screen (Ctrl+Shift+F), Typewriter Mode, Dark Mode, | Page Breaks, Page Count, Show Outline, Show Tags, Ruler, | Text Size >, Page Zoom >, Customize Layout. Checked items show a check mark at the left.
- Tools, Reports, Revisions, Production, Customize: as listed in SYSTEM_DESIGN.md Appendix A.
- Help: feature search box, Quick FAQ & Support, Knowledgebase, Guides & Tutorials, Keyboard Shortcuts, Install App, and account items.

# Unlimited Draft

A personal screenwriting web app. It follows the layout and behavior of a familiar screenwriting tool's free tier, with no limit on the number of scripts, and stores every script in a private GitHub repository.

- Live: https://unlimited-draft.vercel.app
- Design: [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) (source of truth)
- Decisions made while building: [docs/DECISIONS.md](docs/DECISIONS.md)
- Status: [docs/PROGRESS.md](docs/PROGRESS.md)

## How it works

- **Editor.** ProseMirror with one block node per screenplay element. Enter and Tab move between elements; the flow table is in `src/editor/flow.ts` and all shortcuts are in `src/editor/keymap.ts`.
- **Pages.** A pure TypeScript layout engine (`src/layout`) wraps and paginates the script by character counts (Courier Prime 12 pt: 10 characters per inch, 6 lines per inch, 54 lines per page). The same output draws the page gaps on screen and the PDF, so they always match. All geometry is in `src/layout/geometry.ts`.
- **Storage.** Every edit lands in IndexedDB first. A sync engine batches saves into commits on the private scripts repo through a small proxy in `/api`. The GitHub token never reaches browser JavaScript.
- **Offline.** The app is a PWA: it loads and edits with no network and pushes when it is back online.

## Develop

```
npm install
npm run dev        # app only, no sign in
npm test           # unit tests (layout golden tests, PDF, import, sync)
npm run e2e        # Playwright end-to-end tests
npm run lint
npm run build
```

To run with sign in and sync locally, create a GitHub OAuth App, then:

```
npm run setup      # paste the OAuth Client ID and Secret; writes .env.local
vercel dev
```

Environment variables (set on Vercel): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_GITHUB_LOGIN`, `SCRIPTS_REPO`, `COOKIE_SECRET`. Never commit them.

## Fonts and licenses

Courier Prime is used under the SIL Open Font License (`public/fonts/OFL.txt`). The English spelling dictionary is from the `dictionary-en` package (`public/dict/LICENSE.txt`). Icons are Lucide.

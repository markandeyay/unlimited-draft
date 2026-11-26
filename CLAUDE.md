# Unlimited Draft

Personal screenwriting web app that copies WriterDuet's free tier layout and behavior. One user (Markandeya).

**SYSTEM_DESIGN.md is the source of truth. If anything conflicts with it on product behavior, SYSTEM_DESIGN.md wins.** Where it is silent, copy WriterDuet (see `docs/writerduet-reference/`) and log the decision in `docs/DECISIONS.md`.

## Stack

- React 18 + TypeScript, Vite, CSS Modules with CSS variables (light/dark)
- ProseMirror directly (no TipTap), one block node per screenplay element
- Custom layout engine in `src/layout` (pure TS, no DOM, no React), feeds both screen and PDF
- pdf-lib (export, embedded Courier Prime), pdfjs-dist (import)
- Dexie (IndexedDB) offline-first, sync to a private GitHub repo through `/api/github/*`
- Vercel serverless functions in `/api` (GitHub OAuth, proxy)
- Zustand, minisearch, nspell (worker), vite-plugin-pwa
- Vitest (unit), Playwright (e2e)

## Folder structure

```
api/                 Vercel functions: auth/login, auth/callback, auth/me, auth/logout, github proxy
public/fonts/        Courier Prime TTFs
scripts/setup.html   local OAuth credential helper (npm run setup)
src/app/             routes, shell, providers
src/ui/              rail, panels, menus, toolbar, dialogs, library
src/editor/          schema, plugins, keymap.ts, flow.ts, autocomplete
src/layout/          geometry.ts, wrapping, pagination (pure TS)
src/pdf/             export, import
src/import/          fdx, fountain, writerduet parsers
src/storage/         Dexie db, models
src/sync/            GitHub client, commit queue, merge
src/reports/ src/revisions/ src/history/ src/search/ src/spell/ src/settings/
tests/layout/        golden pagination tests
tests/e2e/           Playwright
docs/                DECISIONS.md, PROGRESS.md, writerduet-reference/
```

## Commands

- `npm run dev` dev server
- `npm run build` typecheck and build
- `npm test` Vitest
- `npm run e2e` Playwright
- `npm run lint`
- `npm run setup` open the OAuth setup helper

## Rules

- Never use em dashes anywhere: UI text, docs, comments, commit messages.
- Never commit secrets. This repo is public. `.env*` is gitignored. Never print secrets.
- Never modify or delete anything in Markandeya's WriterDuet account. Look only.
- Do not copy WriterDuet's name, logo, or image assets. Use Lucide icons. The app name is Unlimited Draft. No "Upgrade to Pro" button.
- `src/layout` stays pure TypeScript: no DOM, no React imports.
- All page geometry lives in `src/layout/geometry.ts`. Element flow lives in `src/editor/flow.ts`. Shortcuts live in `src/editor/keymap.ts`.
- Dropped features (SYSTEM_DESIGN.md Section 10) are removed from menus, not greyed out.
- After each milestone: run tests, fix failures, commit, push to origin main, update `docs/PROGRESS.md`.
- Log every judgment call in `docs/DECISIONS.md`.

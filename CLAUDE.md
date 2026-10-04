# CLAUDE.md

Guidance for Claude Code working in this repository.

# Tedmarks

Place memory app (restaurants first). pnpm workspace for TypeScript + a SwiftUI
iOS app. Successor to memorapp (`/Users/tedshaffer/Documents/Projects/memorapper`,
reference only — never modify it).

Read before larger changes:
- `docs/tedmarks-functionality-draft.md` — what the app does (capture-first)
- `docs/tedmarks-decisions.md` — platform/product decisions
- `docs/tedmarks-data-model.md` — the data model (source of the zod schemas)

## Commands

```bash
pnpm install
pnpm build                 # build shared then api
pnpm typecheck             # run after every TypeScript change
pnpm test
pnpm dev:api
pnpm openapi:generate      # after any schema change
cd ios && xcodegen         # regenerate the Xcode project after editing project.yml or adding files
cd ios/TedmarksKit && swift test
```

## Non-negotiable rules

1. **`.js` extensions on relative imports** (NodeNext), same as Tedography.
2. **`shared/src/schema` is the source of truth** for record shapes. Change the
   zod schema first, then `pnpm openapi:generate`, then the API and Swift models.
   Keep `docs/tedmarks-data-model.md` in step.
3. **Rules exist in TypeScript and Swift.** Any change to `shared/src/rules/*`
   must be mirrored in `ios/TedmarksKit` and covered by a case in
   `shared/fixtures/*.json` (both test suites read them).
4. **Every synced record has the SyncedRecord fields** (client UUID `id`,
   `createdAt/By`, `modifiedAt/By`, optional `deletedAt` tombstone, `serverSeq`).
   Never hard-delete synced records; set `deletedAt`.
5. **"Joint unless we disagree" is computed, never stored.** Ratings are stored
   per scope (`joint` or `person`).
6. **Photos are references** to the iPhone Photos library — never upload or
   store image bytes server-side (menu/receipt images are only passed through to
   Claude and discarded).
7. **API keys never go to the phone.** Google Places and Claude are called from the API.
8. **Secrets stay out of logs and git** (`api/.env` is ignored; don't print config values).
9. Prefer small, focused changes. `pnpm typecheck` and tests must pass.

## Layout

- `shared/` — `@tedmarks/shared`: `src/schema` (zod), `src/rules`, `fixtures/`, `openapi/` (generated)
- `api/` — `@tedmarks/api`: Express 5 + MongoDB native driver; code grouped by area
  (`auth/`, `sync/`, `google/`, `ai/`, `db/`, `tools/`). Endpoints designed but not
  built return 501 via `notImplemented()`.
- `ios/` — XcodeGen (`project.yml`); app in `Tedmarks/` (`App/`, `Features/<screen group>`
  matching the Figma screen numbers), `TedmarksKit/` Swift package (models, rules,
  App Intents shared with extensions), `TedmarksWidgets/` (Lock Screen widget,
  Control Center control, Live Activity).
- `web/` — placeholder.

# Tedmarks

Remembers places and what we thought of them — mainly restaurants, designed to
support other kinds of places later. Successor to memorapp.

- **iOS app** (SwiftUI, iOS 18+): fast capture during and after a visit.
- **Web app**: browse, plan, refine (later).
- **API** (TypeScript, Express 5, MongoDB): sync, Google Places proxy, Claude.

Design docs live in [`docs/`](docs/): functionality, decisions, data model,
and the memorapp reference spec. Screens are in Figma:
https://www.figma.com/design/EZkLMg0aUJJh2UZDY7mYcE

## Layout

```
shared/   @tedmarks/shared — zod schemas (source of truth for the data model),
          shared rules (ratings, what-to-order), JSON fixtures, generated OpenAPI
api/      @tedmarks/api — Express + MongoDB
web/      placeholder
ios/      SwiftUI app (XcodeGen project), TedmarksKit package, widget extension
docs/
```

## TypeScript (shared + api)

```bash
pnpm install
pnpm build              # shared must be built before api runs
pnpm typecheck
pnpm test
pnpm dev:api            # http://localhost:4200/health
pnpm indexes:create     # create MongoDB indexes (needs api/.env)
pnpm openapi:generate   # after changing a schema in shared/src/schema
```

Copy `api/.env.example` to `api/.env` and fill it in. The API runs without a
database (health check only) when `MONGODB_URI` is unset.

## Deploying the API (Heroku)

The API runs on Heroku as **tedmarks-api** (Eco dyno; sleeps after 30 idle
minutes, so the first request after a break takes a few seconds):
https://tedmarks-api-29d4a84bccc7.herokuapp.com/health

```bash
git push heroku main          # builds with pnpm (pnpm -r build) and starts node api/dist/index.js
heroku logs -a tedmarks-api --tail
heroku config -a tedmarks-api # GOOGLE_PLACES_API_KEY, API_ACCESS_KEY, MONGODB_DB
```

Every request except `/health` needs the `X-Tedmarks-Key` header matching
`API_ACCESS_KEY` (interim protection until Sign in with Apple). Set config
values without surrounding quotes.

## iOS

```bash
cd ios
xcodegen                # generates Tedmarks.xcodeproj from project.yml (not committed)
open Tedmarks.xcodeproj
```

- Signing team `SNCCBFHL45` is set in `ios/project.yml`; bundle ID `com.tedshaffer.tedmarks`.
- **Server URL and access key** come from `ios/Config/Secrets.xcconfig` (git-ignored).
  Copy `Secrets.example.xcconfig` to create it; it points at Heroku by default, or at
  `http:/$()/Teds-MacBook-Pro.local:4200` for the dev server on the Mac. Rerun
  `xcodegen` after creating it.
- `cd ios/TedmarksKit && swift test` runs the shared-rule tests on the Mac.
- Debug-only simulator launch flags (no tapping needed), e.g.
  `xcrun simctl launch booted com.tedshaffer.tedmarks -demoVisit -openWrapUp`:
  `-demoVisit` (in-progress visit at Doppio Zero with 4 dishes), `-openStartVisit`,
  `-startVisitSearch <text>`, `-showMore`, `-openSettings`, `-openWrapUp`, `-openRateDish`.

## Keeping Swift and TypeScript in sync

The display rules exist in both languages (`shared/src/rules/*.ts` and
`ios/TedmarksKit/Sources/TedmarksKit/*.swift`). Both test suites run the same
cases from `shared/fixtures/*.json` — add a case there when changing a rule.

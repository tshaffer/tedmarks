# Tedmarks — Technical & Product Decisions

> Decisions made before starting development (2026-10-03). Companion to
> [`tedmarks-functionality-draft.md`](tedmarks-functionality-draft.md).
> Status key: ✅ decided · 🟡 proposed, awaiting confirmation.

---

## Platform & architecture

| # | Topic | Decision | Status |
|---|---|---|---|
| 1 | iOS app | **Native SwiftUI** | ✅ |
| 2 | Minimum iOS | **iOS 18** (Control Center controls, interactive Live Activities, App Intents) | ✅ |
| 3 | Backend | **New TypeScript Express + MongoDB API** | ✅ |
| 3a | Hosting | **Heroku** app `tedmarks-api` (Eco dyno, same account as memorapp). **MongoDB Atlas** (same cluster as Tedography, new `tedmarks` database). **API on a small cloud host** so phones can reach it from restaurants (Tedography's API runs locally on the Mac, which phones can't reach away from home) | ✅ |
| 4 | Sign-in | Interim: a shared access key (`X-Tedmarks-Key`) on every request except /health. Then **Sign in with Apple**, allowlisted to Ted's and Lori's Apple IDs. The server verifies Apple's identity token and issues its own session token. | ✅ |
| 5 | Offline & sync | Each phone keeps a full local copy (SwiftData) plus an outbox queue that syncs when online. Per-person ratings never conflict (stored separately). Shared fields (notes, dish names, order): **latest change wins**. | ✅ (no real choice) |
| 6 | Data model | Drafted by Claude from the functionality doc, reviewed by Ted | ✅ |
| 7 | Place data | **Google Places**, called through the API (key never on the phone). Keeps memorapp's Google place IDs. | ✅ |
| 8 | Photos | **Option A: references to the iPhone Photos library** (no copies). Menu and receipt pages saved to a "Tedmarks" album in Photos. Built to migrate later (see below). | ✅ |
| 9 | AI | **Claude, called from the API server** (key never on the phone). Speech-to-text on the phone (Apple Speech framework, works offline); the transcript is sent to Claude for structuring. Menu and receipt photos go to Claude directly. Monthly cost ceiling still to set. | ✅ (ceiling open) |
| 10 | Apple Developer account | Ted already has one (Team ID `SNCCBFHL45`). TestFlight for installing on both phones. Bundle ID **`com.tedshaffer.tedmarks`** (widgets: `com.tedshaffer.tedmarks.widgets`). | ✅ |
| 11 | Repo | **`/Users/tedshaffer/src/tedmarks`** is the root for the iOS app, the web app, and the API | ✅ |

### Proposed repo layout

```
tedmarks/
  api/        TypeScript Express + MongoDB
  web/        Web app (stack TBD)
  ios/        SwiftUI Xcode project
  shared/     API schema (e.g. OpenAPI / JSON Schema) shared by web and iOS
  docs/
```

Build order: API + data model → memorapp migration → iOS capture loop → web.

---

## Product decisions affecting the data model

| Question | Decision |
|---|---|
| Dish ratings | **Joint unless we disagree**, same rule as visit verdicts |
| Privacy | **Everything is shared** between Ted and Lori (no private notes) |
| AI drafts | **Wait until confirmed** (no auto-apply). Unconfirmed drafts stay in the Inbox. |
| Lori's opinions (initially only Ted has the app) | **"Rate for" switch: Us / Ted / Lori** on dish rating and wrap-up. "Us" records a joint rating; Ted or Lori records a per-person rating that splits it. When Lori gets the app she rates for herself. |

---

## Photos (decision #8)

**Initial implementation: only Ted runs Tedmarks, and photos stay in the iPhone
Photos app.**

- Tedmarks stores a **reference** to each photo, never the image. Full-size viewing
  comes straight from Photos (downloading from iCloud on demand if "Optimize
  iPhone Storage" is on).
- After a visit, photos taken at the place during the visit window are found and
  attached automatically. Requires Photos **Full Access**.
- **Menu and receipt pages** from the in-app document camera are saved to a
  **"Tedmarks" album** in Photos. They're sent to the API only transiently, for
  Claude to read; the server doesn't keep them.
- A photo deleted from Photos shows as a missing placeholder in Tedmarks.
- The web app shows no photos for now.

**Built so we can switch later (to iCloud/CloudKit copies or R2/S3) without
losing photos:**

1. Each photo record has a **storage-location field**; initially always "Photos
   library". New locations are additive.
2. Each record stores what's needed to find the photo again: the Photos **local
   identifier**, the **iCloud cloud identifier** (survives a new phone),
   **capture time**, **location**, and a **content hash**. The same data enables
   later linking to **Tedography** assets.
3. A future switch is a one-time job on the iPhone: read each referenced photo
   from Photos, upload a copy, record the new location, keep the old reference.
   Only photos deleted from Photos before the switch are at risk (recoverable from
   Tedography if imported, or from Recently Deleted within 30 days).

**Not doing for now:** server-side thumbnail copies (could add later as insurance
and for the web app).

---

## Web app (decided 2026-10-06)

| Topic | Decision |
|---|---|
| Role | Browse, plan and tidy up at a desk; capture stays on the phone |
| Sign-in | **Sign in with Apple** (web first), allowlisted Apple accounts; server issues its own session cookie. The phone keeps the shared key until it moves over. |
| Design | **Figma first** (web page in the existing Tedmarks file) |
| Stack | React + TypeScript + Vite, MUI, Google Maps JavaScript API (browser key restricted to the app's address) |
| Data | The web app is another sync client (pull everything, push edits); shared TS rules for ratings and "what to order" |
| Hosting | Served by the same Heroku app |
| First version | Map + list + detail panel, filters, place page, edit places, **add past visits**, **add menus from a PDF or JPG** (read by Claude; files not kept), save places to try |
| Not on the web | Photos and menu page images (they're references into the iPhone Photos library); menus show as their dish list |
| Main flow | **Choose a restaurant, then act on it.** Choose by name search, a map pin (Google's or ours) or a row in the list; the panel's actions depend on status (visited: edit/delete visits, add a past visit; never visited: save as want to go, add a menu, add a past visit). No global "+ Add". |
| Deleting | **Wherever something can be edited, it can be deleted.** Deletes are immediate with an Undo banner (no confirmation dialog). |

## Still open (not blocking)

- AI monthly cost ceiling

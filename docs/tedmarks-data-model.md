# Tedmarks — Data Model (Draft v1)

> Draft for review, 2026-10-03. Derived from
> [`tedmarks-functionality-draft.md`](tedmarks-functionality-draft.md) and
> [`tedmarks-decisions.md`](tedmarks-decisions.md).
> The same model is used in MongoDB (API) and SwiftData (iPhone). Field names
> are camelCase; types are TypeScript-style.

---

## 1. Design principles

1. **Generic core, kind-specific extensions.** Places, visits, items and
   ratings work the same for every kind of place. Restaurant-specific details
   (subtype, meals, dishes) live in kind-specific attributes or in "items",
   which are dishes for restaurants. Adding trails later adds a kind, not new
   collections.
2. **Small, flat records for sync.** Things edited independently (a rating, a
   note, a dish in our order) are separate records, so two edits rarely touch the
   same record, and "latest change wins" is per record.
3. **IDs are created on the phone** (UUIDs), so captures work fully offline and
   sync later without ID remapping.
4. **Ratings are stored per scope** (joint or per person), and "joint unless we
   disagree" is computed when displaying, never stored.
5. **Derived things aren't stored.** Inbox contents, a place's "What to order"
   groups, "visited" counts and the current verdict are computed from the records.
6. **Photos are references** into the iPhone Photos library (decision #8), with
   enough information to find them again or migrate them later.

---

## 2. Overview

```
User ──1:1── Person (Ted)            Person (Lori, guests…)
                │                          │
                └──────┐   ┌───────────────┘
                       ▼   ▼
Place ──< Visit ──< VisitItem (our order: "a dish we ordered/rated")
  │         │          │
  │         │          └──< Rating (dish)   ─┐
  │         ├──< Rating (visit verdict) ────┤  scope: joint | person
  │         ├──< Note                       │
  │         ├──< Photo ──(tagged)──> VisitItem
  │         ├──< VoiceNote ──> Draft ──(proposes changes to)──> Visit…
  │         └──< Menu ──< MenuPage(Photo)
  │
  ├──< PlaceItem (the place's dish catalog: from menus, orders, receipts)
  └── PlaceSubtype (editable list, per kind)
```

Collections (MongoDB) / models (SwiftData):

| Collection | What it holds | Approx. size |
|---|---|---|
| `users` | People who can sign in (Ted now; Lori later) | 1–2 |
| `people` | Ted, Lori, remembered guests | ~10s |
| `places` | Saved places + Google snapshot | 100s |
| `placeSubtypes` | Editable subtype list per kind (Pizza, Café…) | ~20 |
| `placeItems` | Per-place catalog of items (dishes) | 1,000s |
| `menus` | Saved menu captures (pages = photos) | 10s–100s |
| `visits` | One occasion at a place | 100s/yr |
| `visitItems` | What we ordered on a visit | 1,000s |
| `ratings` | Visit verdicts and item ratings, joint or per person | 1,000s |
| `notes` | Visit / item / place notes | 100s |
| `photos` | References to Photos-library images | 1,000s |
| `voiceNotes` | Transcripts of hold-to-talk recordings | 100s |
| `drafts` | AI-proposed changes awaiting confirmation | 10s pending |
| `userSettings` | Per-user preferences | 1–2 |

---

## 3. Common fields (every synced record)

```ts
interface SyncedRecord {
  id: string;            // UUID, generated on the device that created it
  createdAt: string;     // ISO 8601, device time
  createdBy: string;     // userId
  modifiedAt: string;    // ISO 8601, device time — used for latest-wins
  modifiedBy: string;    // userId
  deletedAt?: string;    // tombstone; records are never hard-deleted while syncing
  serverSeq?: number;    // assigned by the API on every accepted write (monotonic);
                         // phones pull "everything with serverSeq > N"
}
```

**Sync rule:** when two versions of the same record arrive, the one with the
later `modifiedAt` wins (whole record). Records are kept small so this is rarely
lossy. Per-person ratings never conflict, because Ted's and Lori's ratings are
different records.

---

## 4. People & users

```ts
interface User extends SyncedRecord {
  appleUserId: string;   // stable "sub" from Sign in with Apple
  personId: string;      // the Person this user is
  email?: string;        // as provided by Apple (may be a relay address)
  allowed: boolean;      // allowlist gate
}

interface Person extends SyncedRecord {
  displayName: string;   // "Ted", "Lori", "Mike"
  kind: 'household' | 'guest';   // household = Ted & Lori (have opinions we rate for)
  userId?: string;       // set when this person can sign in (Ted now, Lori later)
  lastSeenAt?: string;   // for ordering guest chips
}
```

- Ted and Lori are both `household` people from day one. Lori has no `userId`
  until she gets the app; Ted rates on her behalf with the **Us / Ted / Lori**
  switch.
- Guests are remembered names only (decision: guests by name).

---

## 5. Places

```ts
type PlaceKind = 'restaurant';           // later: 'hikingTrail' | 'bikeTrail' | 'lodging' | 'grocery' | 'other'
type PlaceStatus = 'wantToGo' | 'beenThere';
type InterestLevel = 'curious' | 'reallyWantToGo';

interface Place extends SyncedRecord {
  kind: PlaceKind;
  status: PlaceStatus;                   // explicit; set to beenThere when the first visit is created
  name: string;                          // defaults to google.name; editable
  subtypeId?: string;                    // → PlaceSubtype ("Pizza")

  google?: GooglePlaceSnapshot;          // absent for places not in Google (e.g. a trail)
  location: GeoPoint;                    // copied from Google or set manually; 2dsphere index

  // pre-visit
  interest?: {
    level: InterestLevel;
    why?: string;                        // "Pizza with Neapolitan crust — recommended by Mike"
    source?: string;                     // "Mike", "SF Chronicle", "Instagram"
    sourceUrl?: string;
    savedAt: string;
  };

  // post-visit (place-level; per-visit verdicts live in ratings)
  review?: string;                       // longer overall review (usually written on the web)
  refinedRating?: number;                // optional 0–10
  tags: string[];                        // "patio", "noisy", "date night"
  coverPhotoId?: string;                 // → Photo; default = most recent visit photo

  attributes?: PlaceAttributes;          // kind-specific, see below; absent until set
  latestMenuId?: string;                 // → Menu
  neverAskHere?: boolean;                // suppress prompts/suggestions here
}

interface GooglePlaceSnapshot {
  placeId: string;                       // unique index
  name: string;
  formattedAddress?: string;
  primaryType?: string;                  // "pizza_restaurant"
  primaryTypeLabel?: string;             // "Pizza Restaurant"
  addressComponents?: { longName: string; shortName: string; types: string[] }[];
  website?: string;
  phone?: string;
  priceLevel?: number;
  rating?: number;                       // Google's 1–5
  ratingsCount?: number;
  openingHours?: { periods: OpeningPeriod[]; weekdayText: string[] };
  utcOffsetMinutes?: number;
  fetchedAt: string;                     // for "updated Jan 16 · Refresh"
}

interface GeoPoint { type: 'Point'; coordinates: [lng: number, lat: number] }

type PlaceAttributes =
  | { kind: 'restaurant'; mealsServed: { breakfast: boolean; lunch: boolean; dinner: boolean } }
  // later: | { kind: 'hikingTrail'; lengthMiles?: number; elevationGainFt?: number; difficulty?: …; loop?: boolean }
  ;

interface PlaceSubtype extends SyncedRecord {
  kind: PlaceKind;
  name: string;                          // "Pizza", "Café", "Taqueria"
  icon?: string;                         // SF Symbol / emoji key
  sortOrder: number;
}
```

---

## 6. Items (dishes)

Two levels: the **place's catalog** of items, and **our order** on a visit.

```ts
interface PlaceItem extends SyncedRecord {       // "a dish at this place"
  placeId: string;
  name: string;                                  // "Doppio Zero pizza"
  normalizedName: string;                        // lowercase/trimmed, for matching & dedupe
  section?: string;                              // "Pizze", from the menu
  price?: string;                                // as printed ("24")
  sources: ('menu' | 'order' | 'receipt' | 'voice' | 'manual' | 'imported')[];
  onLatestMenu?: boolean;                        // false → greyed "not on the latest menu"
  mergedIntoId?: string;                         // set when merged as a duplicate (web "merge dishes")
}

interface VisitItem extends SyncedRecord {       // "a dish in our order on this visit"
  visitId: string;
  placeItemId?: string;                          // absent while unnamed
  placeholderLabel?: string;                     // "Dish 4" until named (receipt/voice/manual)
  ordered: boolean;                              // true if added via "What did you order?";
                                                 // rating an unordered dish adds it with ordered = true
  addedVia: 'order' | 'rating' | 'receipt' | 'voice' | 'sameAsLastTime' | 'imported';
  sortOrder: number;
}
```

- "Not rated yet" = a VisitItem with no Rating records.
- "Same as last time" copies the previous visit's VisitItems (without ratings).
- The Place page's **What to order** groups are computed from VisitItems +
  Ratings across visits (see §13).

---

## 7. Visits

```ts
type VisitStatus = 'inProgress' | 'ended';
type VisitOrigin = 'startVisit' | 'photoSuggestion' | 'receipt' | 'manual' | 'imported';

interface Visit extends SyncedRecord {
  placeId: string;
  startedAt: string;
  endedAt?: string;                      // End visit, verdict from notification, or auto-end
  status: VisitStatus;
  origin: VisitOrigin;
  participantIds: string[];              // → Person (Ted, Lori, guests)
  isFirstVisit: boolean;                 // drives 02b vs R-02b (computed at creation)
  menuId?: string;                       // menu captured or used on this visit
  promptNotificationSentAt?: string;     // the one time-based prompt (06/07)
  wrapUpCompletedAt?: string;
  tags: string[];                        // this occasion only ("noisy that night")
}
```

---

## 8. Ratings (joint unless we disagree)

One collection for both visit verdicts and dish ratings.

```ts
type VerdictValue = 'wontReturn' | 'tryAgain' | 'wouldReturn';     // 👎 👌 👍
type ItemRatingValue = 'skip' | 'good' | 'loved';                  // 👎 👍 😍

interface Rating extends SyncedRecord {
  subjectType: 'visit' | 'visitItem';
  subjectId: string;
  visitId: string;                       // denormalized for fast per-visit loading
  placeId: string;                       // denormalized for place-level summaries
  scope: 'joint' | 'person';
  personId?: string;                     // required when scope = 'person'
  value: VerdictValue | ItemRatingValue; // which set depends on subjectType
  enteredBy: string;                     // userId (Ted entering Lori's rating is allowed)
  origin: 'tap' | 'notification' | 'draft' | 'imported';
  importedScore?: number;                // original memorapp 0–10, when imported
}
// Unique: (subjectType, subjectId, scope, personId)
```

**Display rule** (computed, never stored), for a subject with household
participants P:

1. For each person p in P: `effective(p) = personRating(p) ?? jointRating`.
2. If every `effective(p)` is the same (or only a joint rating exists) → show
   **joint** ("👍").
3. Otherwise → show **split** ("Lori 😍 · Ted 👎") and flag a disagreement.

Examples:

| Records | Shown |
|---|---|
| joint 😍 | 😍 |
| joint 😍, Ted 👎 | Lori 😍 · Ted 👎 (split) |
| Ted 👍, Lori 👍 | 👍 |
| Ted 👍 only | 👍 (Lori has no opinion recorded) |

The **Us / Ted / Lori** switch chooses `scope`/`personId` when tapping a rating.

---

## 9. Notes & tags

```ts
interface Note extends SyncedRecord {
  placeId: string;
  visitId?: string;                      // absent = place-level note
  visitItemId?: string;                  // dish note ("dry")
  personId?: string;                     // whose opinion ("Ted: dry"); absent = ours
  text: string;
  origin: 'typed' | 'voice' | 'imported';
  draftId?: string;                      // when it came from a confirmed draft
}
```

Tags live on both the **Place** (`tags: string[]`, lasting traits: "patio") and
the **Visit** (`tags: string[]`, that occasion: "noisy that night"). Drafts can
propose either.

---

## 10. Photos (references to the Photos library)

```ts
type PhotoRole = 'visit' | 'menuPage' | 'receipt';
type PhotoStorage = 'photosLibrary';     // later: 'icloud' | 'r2' — additive

interface Photo extends SyncedRecord {
  placeId: string;
  visitId?: string;
  menuId?: string;                       // for menu pages
  role: PhotoRole;
  storage: PhotoStorage;

  // How to find it again (decision #8)
  localIdentifier?: string;              // PHAsset id on the capturing device
  cloudIdentifier?: string;              // PHCloudIdentifier; survives a new phone
  capturedAt: string;
  location?: GeoPoint;
  contentHash?: string;                  // SHA-256 of original bytes; Tedography matching
  pixelWidth?: number;
  pixelHeight?: number;
  capturedByPersonId: string;            // whose phone

  taggedVisitItemIds: string[];          // "what's in this photo" (multi-dish)
  tedographyAssetId?: string;            // set when linked after import into Tedography
  availability: 'ok' | 'missing';        // missing = deleted from Photos
}
```

Menu and receipt pages are saved to the **"Tedmarks" album** in Photos and
referenced the same way, with `role` set accordingly.

---

## 11. Menus

```ts
interface Menu extends SyncedRecord {
  placeId: string;
  visitId?: string;                      // visit it was captured on
  capturedAt: string;
  pagePhotoIds: string[];                // ordered → Photo (role: menuPage)
  readStatus: 'pending' | 'read' | 'failed';
  readAt?: string;
  extracted?: { section?: string; name: string; price?: string }[];  // from Claude
}
```

When a menu is read, its items are upserted into `placeItems` (matched by
`normalizedName`), and `onLatestMenu` is recomputed for that place.

---

## 12. Voice notes & drafts

```ts
interface VoiceNote extends SyncedRecord {
  visitId: string;                       // current visit, or most recent if none active
  personId: string;                      // speaker (owner of the phone)
  recordedAt: string;
  durationSec: number;
  transcript: string;                    // on-device speech-to-text
  audioLocalPath?: string;               // audio kept on the phone (see open questions)
  structuredAt?: string;                 // when sent to Claude
  draftId?: string;
}

type ChangeKind = 'verdict' | 'itemRating' | 'itemNote' | 'visitNote' | 'placeTag' | 'visitTag' | 'addItem' | 'nameItem';

interface Draft extends SyncedRecord {
  visitId: string;
  placeId: string;
  sourceType: 'voiceNote' | 'receipt';
  sourceId: string;                      // VoiceNote id or receipt Photo id
  status: 'pending' | 'confirmed' | 'dismissed';   // no auto-apply (decision)
  changes: ProposedChange[];
  confirmedAt?: string;
}

interface ProposedChange {
  id: string;
  kind: ChangeKind;
  keep: boolean;                         // ✓ (default) / ✕ in the review screen
  evidence?: string;                     // quoted words: "we'd definitely come back"
  personId?: string;                     // whose opinion, when attributable
  payload: Record<string, unknown>;      // e.g. { visitItemId, value: 'good' } or { text: '…' }
}
```

Confirming a draft writes ordinary records (Rating, Note, VisitItem, place
tags) with `origin: 'draft'`.

---

## 13. Derived views (computed, not stored)

| View | Computed from |
|---|---|
| **Inbox** | Drafts with `status = pending` · photo-based visit suggestions (on device) · ended Visits with no verdict |
| **Place "been there" verdict** | Latest Visit's verdict (display rule §8) |
| **Visit count / status chip** | Visits per place |
| **What to order** (Place page) | Per PlaceItem across visits: *Order again* = every rating 😍/👍 · *We disagree* = any split · *Skip* = any 👎 · greyed if `onLatestMenu = false` |
| **"2 of 4 rated"** | VisitItems vs. Ratings for the visit |
| **Repeat visit "Ordered before"** | VisitItems from earlier visits at the place, with their ratings |

**Photo-based visit suggestions** are computed on the iPhone (it's the only
thing that can read Photos) and kept on the device; dismissals are stored
locally so they aren't suggested again.

---

## 14. Settings

```ts
interface UserSettings extends SyncedRecord {
  userId: string;
  promptDelayMinutes: number;            // default 90
  quietHours?: { start: string; end: string };   // "22:00"–"08:00"
  menuPromptOnFirstVisit: boolean;       // default true
  photoDiscoveryEnabled: boolean;        // default true
  eveningNudge?: { enabled: boolean; time: string };   // default off
  defaultRateFor: 'joint' | string;      // 'joint' or a personId; default 'joint'
  nearbyRadiusMeters?: number;           // Start visit search radius: 1, 5 or 20 miles; default 1 mile
}
```

---

## 15. Indexes (MongoDB)

| Collection | Index |
|---|---|
| all | `{ serverSeq: 1 }` (sync pull) · `{ id: 1 }` unique |
| `places` | `{ 'google.placeId': 1 }` unique, sparse · `{ location: '2dsphere' }` · `{ status: 1 }` |
| `placeItems` | `{ placeId: 1, normalizedName: 1 }` |
| `visits` | `{ placeId: 1, startedAt: -1 }` · `{ status: 1 }` |
| `visitItems` | `{ visitId: 1 }` |
| `ratings` | `{ subjectType: 1, subjectId: 1, scope: 1, personId: 1 }` unique · `{ placeId: 1 }` · `{ visitId: 1 }` |
| `notes` | `{ placeId: 1 }` · `{ visitId: 1 }` |
| `photos` | `{ visitId: 1 }` · `{ cloudIdentifier: 1 }` · `{ contentHash: 1 }` |
| `drafts` | `{ status: 1 }` |

---

## 16. Sync API (sketch)

| Endpoint | Purpose |
|---|---|
| `POST /auth/apple` | Exchange Apple identity token for a session token (allowlist check) |
| `GET /sync/pull?since=<serverSeq>&limit=<n>` | Records changed since N, across collections, oldest first (`hasMore` when there's another page) |
| `POST /sync/push` | Batch of created/modified/deleted records; returns `accepted` (with serverSeqs), `newer` (server versions that beat the pushed ones) and `rejected` (failed validation) |
| `GET /places/nearby?lat&lng` | Google Nearby Search proxy (Start visit) |
| `GET /places/search?q&lat&lng` | Google text search proxy ("Somewhere else…") |
| `POST /places/:id/refresh` | Re-fetch the Google snapshot |
| `POST /ai/menu` | Menu page images → extracted items (images not kept) |
| `POST /ai/receipt` | Receipt image → items, date, place hint (image not kept) |
| `POST /ai/voice` | Transcript + visit context → proposed changes (Draft) |

**How sync works (built 2026-10-05):**
- **Push is a patch.** A client sends the fields it keeps; fields it leaves out are kept as
  stored (so the web can add fields the iPhone doesn't know about), `null` clears a field,
  nested objects merge. The merged record must pass the collection's zod schema.
- **Latest `modifiedAt` wins**, compared as instants (any offset). An older push gets the
  server's record back in `newer`.
- **One live rating per (subject, scope, person)** is enforced in code, not by a unique
  index (tombstones would collide): the later one wins, the other is tombstoned.
- **The iPhone finds its changes by hash**: each record's last-synced JSON hash is kept
  (`SyncRecordState`), so every edit is caught even if it didn't bump `modifiedAt` (it gets
  bumped at push time). Sync runs a few seconds after each change, when the app opens, and
  when it goes to the background; pulls collect every page before applying (parents first).
- **Ted and Lori have fixed person ids** (`…000000000001` / `…000000000002`) on every
  install, so reinstalls and a second phone don't create duplicates.
- Until Sign in with Apple, `createdBy`/`modifiedBy` are Ted's person id.

---

## 17. memorapp migration mapping

| memorapp | Tedmarks |
|---|---|
| `mongoPlaces` + `mrplaces` (joined on googlePlaceId) | `places` with `google` snapshot, kind `restaurant`. **Non-restaurant places (grocery, lodging, other) are skipped for now.** |
| `restaurantSpecs.restaurantType` | `subtypeId` (PlaceSubtype seeded from the 9 memorapp types) |
| `restaurantSpecs.openForBreakfast/Lunch/Dinner` | `attributes.mealsServed` |
| `interestLevel` 6–10 / 1–5 / 0 | `interest.level` reallyWantToGo / curious / none |
| `placePreview` | `interest.why` |
| visited (derived) | `status` beenThere / wantToGo |
| `placeRating` 8–10 / 4–7 / 1–3 / 0 | **Place-level verdict**, see below; original kept as `refinedRating` |
| `placeReview` | `review` |
| `restaurantReviews[]` | `visits` (origin `imported`, participants Ted & Lori, `startedAt` = stored UTC date) |
| `itemReviews[]` | `placeItems` (dedupe by name) + `visitItems` + joint `ratings` (8–10 loved, 4–7 good, 1–3 skip, 0 unrated; `importedScore` kept) + item `notes` from comments |
| empty item names | dropped |

**Place-level verdict for imported places:** memorapp only had a place-level
rating. Since verdicts here live on visits, the imported verdict is attached to
the place's **most recent imported visit** as a joint rating with `origin:
'imported'`. Places with a rating but no visits get one synthetic imported visit
(date unknown → `startedAt` = the place's creation date, `origin: 'imported'`).

---

## 18. Resolved questions (2026-10-03)

| Question | Decision |
|---|---|
| Voice audio | Stays on the phone (app storage, included in iPhone backups). Only transcripts sync. |
| Imported place verdicts | Attached to the most recent imported visit (§17) |
| Tags | On both places and individual visits |
| memorapp non-restaurant places | Skipped for now |
| Sync conflict granularity | Latest change wins **per record** |

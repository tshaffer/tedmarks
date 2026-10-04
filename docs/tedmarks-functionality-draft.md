# Tedmarks — Functionality & UI (Working Draft)

> Status: **working draft**, from design discussion on 2026-10-03, updated with
> answers to the first round of open questions (see §11).
> Companion to [`memorapp-functionality.md`](memorapp-functionality.md), which
> documents the existing app this builds on. The data model and stack are
> intentionally deferred until functionality and UI settle.

---

## 1. Vision

Tedmarks remembers places and what we thought of them. It is **mainly about
restaurants**, but is designed from the start to support other kinds of places
(hiking trails, bike trails, and more).

There are two apps, under one name:

| App | Job | Optimized for |
|---|---|---|
| **Tedmarks for iOS** | Capture | Speed. Recording opinions in seconds, during or right after a visit, with almost no typing |
| **Tedmarks for web** | Browse, plan, refine | Map, filters, lists, detail, editing, cleanup |

The App Store subtitle can make the iOS app's purpose clear (e.g. "Quick place
notes"). Both Ted and Lori use iPhones.

### The problem we're solving

memorapp had the right data model for restaurants but **wasn't used as intended**,
because entering data took too much effort. We go to restaurants and come away
with definite opinions, but we're unwilling, unable or unmotivated to fill in a
form. **Tedmarks succeeds only if capture is nearly effortless.** Everything else
comes second.

---

## 2. Design Principles

1. **Capture now, structure later.** A capture takes seconds. Turning it into
   structured data is the app's job (with cloud AI help), not the user's.
2. **Starting a visit takes one tap, and the app works out where.** We won't grant
   "Always" location access, so the app can't detect visits in the background.
   Instead, starting a visit is a single tap from the Lock Screen, Control
   Center, the Action Button or Siri. The app then uses the current location to
   pick the restaurant. You never search for the place you're sitting in.
3. **Opinion first, details optional.** A one-tap verdict is a complete review.
   Dishes, notes and photos are bonuses.
4. **Talk or tap, don't type.** Voice for longer thoughts, taps for ratings, chips
   for choices. Typing is the last resort.
5. **Use what we already do.** We take photos with the regular Camera app
   (sometimes), and those photos carry location and time. We may have a receipt
   or a menu. Tedmarks uses those rather than asking for new habits.
6. **Partial is perfect.** Never block saving because something is missing.
   Every capture is valid; it can be enriched later or never.
7. **Capture is available throughout; the app prompts once.** You can capture at
   the table, while waiting for the check, in the car, or days later. The app
   sends **one** prompt per visit, and only asks for what's still missing.
8. **First visits get more attention than repeat visits.** That matches how we
   already behave (we photograph new places more).
9. **One opinion unless we disagree.** Ratings are joint ("ours") by default.
   They split into Ted's and Lori's only when we actually disagree.

---

## 3. Core Concepts

These are functional concepts, not a database schema.

### 3.1 Place

A real-world location, usually from Google Places.

- **Kind**: Restaurant (the only kind at launch). Designed for more later:
  Hiking trail, Bike trail, Lodging, Grocery, Destination/Other…
- **Subtype** (per kind): for restaurants, things like Café, Bar, Bakery,
  Taqueria, Pizza, Italian, Dessert, Seafood (carried over from memorapp; the
  list should be editable).
- **Status**: **Want to go** or **Been there**. This is explicit, unlike
  memorapp, where "visited" was inferred.
- **Pre-visit info**: interest level and why it's interesting (a note, plus the
  source: friend, article, Instagram…).
- **Post-visit summary**: the current overall verdict (from the latest visit), an
  optional refined 0–10 rating, and a review.
- **Kind-specific attributes**: for restaurants: meals served, price level,
  opening hours (from Google).
- **Google data snapshot**: name, address, hours, website, Google rating.
  Unlike memorapp, this should be **refreshable**.

### 3.2 Visit

One occasion at a place. Most capture happens here.

- Place, date, start and end time (start time from the tap that begins the visit).
- **Participants**: Ted, Lori, and **guests by name**. Guest names are
  remembered and offered as chips next time ("+ Mike", "+ Sarah").
- **Verdict**: joint by default, split per person if we disagree (§3.5).
- **Items**: for a restaurant these are **dishes**.
- **Our order** (optional): the dishes we ordered, recorded joint. Each ordered
  dish is either rated or still waiting for a rating. Rating a dish that wasn't
  marked as ordered adds it to the order.
- **Menu photos** (optional): one or more pages, read for dish names and menu
  sections; kept with the visit and reused on later visits.
- **Photos**: copies attached to the visit (§3.4).
- **Voice notes and text notes**.
- **Tags** (e.g. patio, noisy, good for groups, dog-friendly) — suggested from
  voice and notes, editable.
- **Capture state**: *in progress* → *draft* (needs confirming) → *done*.

### 3.3 Dish (restaurant item)

- Name — taken from previous visits, a menu photo, a receipt, dictation, or a
  placeholder ("Dish 1") to be named later.
- **Rating**: 😍 Loved · 👍 Good · 👎 Wouldn't order again. Joint unless we
  disagree, same as the verdict.
- Optional short comment ("too salty", "get this again").
- Optional link to one or more photos.
- Dishes are remembered per place, so **repeat visits can offer "same as last
  time."**

### 3.4 Photo

- **Gathered automatically** from the camera roll: photos taken at the visit's
  location during the visit window. Both people's phones contribute.
- **Stored as copies** in Tedmarks, not as references into Tedography.
- Attached to the **visit**, not to one dish. One photo often shows several
  dishes plus people smiling. The people are part of the memory and are kept.
- **Optional dish tagging**: "What's in this photo?" shows the visit's dish
  chips, with guesses pre-selected by an image model. Never required.
- A good visit photo becomes the **cover image** for that visit and place.
- Special photo types: **menu** (read for dish names) and **receipt** (read for
  dish names, date, and confirming the place).
- Photos also help **find visits we forgot to start** (§4.2).

### 3.5 Ratings

| Level | When | Scale |
|---|---|---|
| **Visit verdict** | Capture time (one tap) | 👎 Won't return · 👌 Would try again · 👍 Would return (matches memorapp's bands) |
| **Dish rating** | Capture time | 😍 Loved · 👍 Good · 👎 Wouldn't order again |
| **Interest level** | Saving a want-to-go place | Curious · Really want to go |
| **Refined rating** | Later, optional, usually on the web | 0–10 (memorapp scale), with labeled bands |

Three verdict levels are enough at capture. Coarse at capture, fine-grained only
if wanted later.

#### Joint vs. split ratings

- The first rating anyone gives is **the joint rating** ("ours").
- If the other person rates the same visit or dish **the same way**, it stays
  joint.
- If they rate it **differently**, it **splits** and shows both:
  "Lori 😍 · Ted 👎".
- Either person can also deliberately split ("I disagree") from the visit or
  dish.
- Summaries and filters use the joint rating. For a split rating, filters treat
  it as matching either person's rating, and it's flagged as a disagreement.

### 3.6 Draft & Inbox

- AI-structured captures (voice → dishes, notes, tags; receipt → dish names)
  become **drafts**. AI processing runs **in the cloud**.
- Drafts collect in the **Inbox** for a one-tap confirm or quick fix.
- Unconfirmed drafts **save as they are** after a while (e.g. 24h). Nothing is
  ever lost.
- The original audio, transcript and photos are always kept.

---

## 4. iOS Capture Workflows

### 4.1 One restaurant visit, from start to finish

Each step after step 1 is optional.

#### 1. Arrive — start the visit (one tap)
Without "Always" location, **starting the visit is the one thing we must do**, so
it has to be as easy as possible. Any of these work:
- **Lock Screen widget**: "We're eating" / "Start visit"
- **Control Center control**
- **Action Button** (iPhone 15 Pro and later)
- **Siri**: "Hey Siri, Tedmarks, we're at dinner"
- **Opening the app** (the start screen *is* the start-visit button)

The app gets the current location (allowed while in use) and shows the nearest
restaurants. Usually the right one is pre-selected and you just confirm, or pick
from 2–3 suggestions. Saved Tedmarks places (especially want-to-go ones) are
listed first.

- **Participants**: defaults to Ted & Lori; tap to add guests from remembered
  names.
- A **Live Activity** appears on the Lock Screen: "At Doppio Zero." It's the
  doorway to all capture during the meal.
- If both of us tap Start, the second person **joins the same visit**.

#### 2. Sitting down — menu and order (optional, ~5–15 sec)
- Right after Start visit: **"You're at Doppio Zero"** with **Snap the menu?**
  (primary on a first visit, secondary on a repeat visit), **Choose from Photos**,
  or **Not now**.
- **Menu camera**: document-style, detects and crops each page. One shutter tap
  per page; pages stack as numbered thumbnails (tap to retake/delete);
  **Done (n)** saves them. Dish names and sections are read in the background
  (offline-safe). Cancel continues without a menu.
- **What did you order?**: offered after the menu camera's Done, and any time
  from **+ Order** in the Live Activity (more rounds, dessert). Multi-select chips
  grouped by the menu's sections; "Not on the menu? Hold to say it"; **Done** or
  **Skip for now**.
- **Repeat visit** (menu photos are saved with the place and reused):
  - **Welcome back** replaces the menu prompt: last visit's verdict as a
    reminder; **What are you ordering?** (primary); **Same as last time** (fills
    in the previous order in one tap); the saved menu's date with **Menu
    changed? Snap new pages** (suggested if the menu is ~6+ months old).
  - **What are you ordering?** lists **Ordered before** first, each dish with how
    we rated it (splits shown per person), so it doubles as a "what was good
    here?" reminder. Dishes missing from the latest menu are greyed ("Not on the
    latest menu") but still selectable. Then the rest of the saved menu.

  | Situation | Where the ordering screen's dishes come from |
  |---|---|
  | First visit, menu photographed | That menu |
  | First visit, no menu | Voice only ("Hold to say what you ordered") |
  | Repeat visit, menu saved before | Past orders with ratings + saved menu |
  | Repeat visit, no saved menu | Past orders with ratings + voice |

#### 3. During the meal — dish capture (~3–5 sec per dish)
From the Live Activity (or the Action Button):
- The Live Activity shows **Our order** (rated dishes with their rating, unrated
  ones outlined with "Rate"), falling back to menu or history chips if no order
  was recorded. Also **+ Order** and **📷 Menu page**.
- **Tap a dish chip** (our order first, then the rest of the menu or history), or dictate a name, or skip
  naming ("Dish 1").
- **Tap a rating**: 😍 / 👍 / 👎.
- Optionally **hold to dictate** a few quiet words.
- Photos are taken with the **regular Camera app**, as now. No Tedmarks camera
  is needed.

Everything at the table is a tap, a photo, or a few dictated words. Nothing
should feel rude or take attention away from the meal.

#### 4. Waiting for the check — wrap-up (~15–30 sec)
A natural pause. The Live Activity offers **Wrap up**:
- Our order, with ratings (joint, or split where we disagree). Ordered dishes
  not rated yet get **inline one-tap ratings** right in the list.
- **Overall verdict**: 👎 / 👌 / 👍.
- **Snap the receipt** to add anything ordered but not recorded, and confirm names.
- **Optional voice summary** (here or in the car): "Patio's better, skip the
  tiramisu."
- **End visit.**

#### 5. Later — the one prompt (safety net)
Without background location, the app can't tell when you leave. Instead the
prompt is **time-based**: it's sent at most once per visit, about **90 minutes
after the visit started** (adjustable in Settings), only if the visit hasn't been
wrapped up:

| Already captured | Prompt |
|---|---|
| Overall verdict | None |
| Dishes, no verdict | "How was Doppio Zero overall?" with three action buttons |
| Nothing | "How was Doppio Zero?" with 👎 / 👌 / 👍 action buttons, plus **hold to talk** |

The action buttons work right from the notification. **One tap = a review**, and
it also ends the visit. The Live Activity ends on its own after a few hours if
nobody ends it.

#### 6. Afterward — automatic enrichment
- Camera-roll photos from the visit window and location are attached.
- Voice notes are transcribed and structured into dishes, ratings, notes and tags.
- Receipt and menu photos are read.
- The result goes into the **Inbox** as a draft if anything needs confirming.

### 4.2 Catching visits we forgot to start

Starting a visit is now the one required step, so we will sometimes forget.
Recovery paths, none of which need background location:

- **Photo-based discovery**: when the app is opened, it looks at new camera-roll
  photos. Photos taken at a restaurant location become a suggested visit in the
  Inbox: "Looks like you were at Capelo's on Friday (3 photos). Add a visit?"
  One tap creates the visit, with photos attached and the date filled in.
- **Receipt photo**: snapping a receipt any time later creates the visit (place,
  date and dishes from the receipt).
- **Manual add**: search a place, set a date. The fallback.
- **Optional evening nudge** (off by default): "Did you eat out today?" at a
  chosen time.

### 4.3 Other ways to capture

| Path | Use | Effort |
|---|---|---|
| **Voice dump** | Hold to talk anytime for a visit: "Brisket was dry, mac and cheese was fine, sauce too sweet, nice patio…" → AI draft | ~20–30 sec |
| **Receipt snap** | One photo → place, date, every dish; then thumb each dish | ~15 sec |
| **Weekly swipe review** | Sunday: "You have 3 visits without a verdict." Cards: → would return, ← won't, ↑ try again, ↓ skip | ~5 sec per visit |
| **Siri / Shortcuts / Action Button** | "Tell Tedmarks the brisket was dry" — attached to the current or most recent visit | Hands-free |
| **Apple Watch** | Start visit; verdict tap | ~2 sec |
| **Share sheet (want to go)** | From Google Maps, Instagram, Safari, Messages → saved as **Want to go**, with an optional one-line "why" and interest level | ~5 sec |

### 4.4 First visit vs. repeat visit

| | First visit | Repeat visit |
|---|---|---|
| Sitting down | "Snap the menu?" (once) | Previous dishes as chips, "Same as last time?" |
| Wrap-up | Verdict, dishes, optional voice summary | "Still would return?", plus only what changed |
| Photos | Auto-attached; dish tagging offered | Auto-attached; no tagging prompt |

### 4.5 Two people

- Each person has the app on their own phone, signed in as themselves.
- When one person starts a visit, the other's phone can **join it** (it shows
  up for them as "Ted started a visit at Doppio Zero — join?").
- Either person can capture; one person's capture is enough.
- Ratings are **joint unless we disagree** (§3.5).
- Photos from both phones are gathered into the visit.

### 4.6 Guardrails

| Risk | Handling |
|---|---|
| Forgetting to start a visit | Photo-based discovery, receipt snap, manual add, optional evening nudge (§4.2) |
| Wrong restaurant suggested at start | Nearest 2–3 shown; saved places first; quick search as fallback |
| Notification fatigue | At most one prompt per visit; quiet hours; unrated visits go to the weekly swipe review instead of reminders |
| Voice/AI mistakes | Everything AI-produced is a reviewable draft; original audio and transcript are kept |
| No signal in the restaurant | All capture works offline and syncs later; AI structuring waits for a connection |

---

## 5. iOS App — Other Screens

The iOS app isn't only capture, but it stays deliberately light.

- **Home**: big **Start visit** button with nearby suggestions; the current visit
  if one is active.
- **Inbox**: drafts to confirm, suggested visits from photos, visits without a
  verdict, photos to tag (optional).
- **Nearby / Map**: saved places around you, want-to-go highlighted, for
  "where should we eat?" Simple filters (status, verdict, subtype).
- **Place**: summary, cover photo, verdict history, best and worst dishes
  ("Order: burrata, Doppio Zero pizza · Skip: tiramisu"), hours, directions
  (opens Apple or Google Maps directly — no emailing yourself).
- **Visit**: dishes and ratings, participants, photos, notes, tags; editable.
- **Settings**: people and remembered guests, prompt timing, quiet hours,
  evening nudge on/off, photo discovery on/off.

---

## 6. Web App

The web app is for browsing, planning and refining. It carries over memorapp's
strengths and fixes its gaps (see the memorapp spec, §§4–8, 12).

### Carried over from memorapp
- **Map** with subtype-specific markers, been-there vs. want-to-go coloring,
  hover cards, a list of what's visible on the map, and a detail panel.
- **Location bar**: current location, recent/saved locations, search.
- **Filters**: distance, subtype, status, open now / open for meals, verdict.
- **All places list** and add/edit place.
- **Visit history** with dishes and ratings.

### New or improved
- **Search by name**, **tags**, **saved filter presets**; filters persist.
- **Rich place pages**: photo gallery, verdict history (with disagreements
  shown), dish leaderboard (best and worst), notes and tags.
- **Refine**: 0–10 ratings, longer reviews, merge duplicate dishes ("Burrata" =
  "burrata w/ peaches"), tag photos, fix AI drafts, split or join ratings.
- **Want-to-go planning**: interest level, source, notes; "near this location."
- **Refresh Google data** for a place (hours, rating).
- **Confirmation and undo** for destructive actions.
- **Proper directions links** (no mailto workaround).

---

## 7. Beyond Restaurants (Deferred)

**Deferred** until we've both thought about it more. The direction so far:

- The app's concepts (place, kind, visit, items, verdict, photos) are designed so
  other kinds can be added without restructuring.
- Trail visits would **start manually**, like restaurant visits. Importing from
  Strava, AllTrails or Apple Health may be added later.
- A trail would have its own attributes (e.g. length, elevation, difficulty) and
  its own visit items and verdict wording — to be designed then.

---

## 8. Migrating memorapp Data

**Everything migrates**, except things that don't make sense in Tedmarks.

### What carries over

| memorapp | Tedmarks |
|---|---|
| Place + Google snapshot | Place (kind: Restaurant or the closest kind) + Google snapshot |
| Restaurant type, meals served | Restaurant subtype, meals served |
| Interest level + preview | Interest level + "why" note |
| Place rating + place review | Place verdict (mapped below), refined rating (original 0–10 kept), review |
| Restaurant reviews (visits) | Visits with date and dishes |
| Dish name, rating, comments | Dish with mapped rating (original 0–10 kept) and comment |

### Status
- Places that memorapp considered **visited** (rating > 0, a review, or any
  visits) become **Been there**; all others become **Want to go**.

### Rating mapping
memorapp's labeled bands map directly to the new levels. The original 0–10 value
is **kept as the refined rating**, so no information is lost.

| memorapp rating | Place verdict | Dish rating |
|---|---|---|
| 8–10 | 👍 Would return | 😍 Loved |
| 4–7 | 👌 Would try again | 👍 Good |
| 1–3 | 👎 Won't return | 👎 Wouldn't order again |
| 0 or empty | No verdict (memorapp used 0 for "not rated") | Unrated |

| memorapp interest level | Tedmarks interest level |
|---|---|
| 6–10 | Really want to go |
| 1–5 | Curious |
| 0 or empty | None |

### Judgment calls
- **Verdicts on imported visits**: memorapp only had a place-level rating, not
  one per visit. The verdict goes on the **place**; imported visits have no
  verdict of their own (rather than guessing which visit it came from).
- **Ratings are joint**: memorapp didn't record who rated, so all imported
  ratings are joint ("ours").
- **Participants on imported visits**: Ted & Lori, since that's the usual case;
  editable later.
- **Visit dates**: memorapp stored them as UTC midnight, which sometimes showed
  as the previous day. Import uses the stored UTC date, which is the date
  originally entered.
- **Empty dish rows** (no name) are dropped.

### What doesn't migrate
- Recent/saved map locations and default filters — they live only in the
  browser's localStorage, not the database. These can be re-created, or
  exported from the browser by hand if worth keeping.
- The separate Google-snapshot collection, as a structure. Its data carries
  over as part of each place.
- Vestigial pieces (unused query feature, OpenAI health check).

---

## 9. Screens to Design (Figma)

### iOS — capture (highest priority)
1. **Start visit**: Lock Screen widget, Control Center control, and the in-app
   home screen with nearby suggestions and participants
2. **Live Activity / Lock Screen**: "At Doppio Zero"; compact and expanded states
3. **Dish capture card**: dish chips (history and menu) + 😍 / 👍 / 👎 + hold to dictate
4. **"Same as last time?"** repeat-visit card
5. **Wrap-up card**: dishes so far, verdict, receipt, voice, end visit
6. **Disagreement display**: a split rating ("Lori 😍 · Ted 👎") and the
   "I disagree" action
7. **Time-based prompt notification**: three action buttons; expanded with hold to talk
8. **Hold-to-talk** recording state
9. **Draft review**: AI-structured visit to confirm or fix
10. **Inbox**, including **suggested visits from photos**
11. **Weekly swipe review** cards
12. **Share-sheet "Want to go"** sheet
13. **Join visit** (second person)
14. **Photo dish-tagging**: photo + dish chips with pre-selected guesses

### iOS — browse (lighter)
15. Nearby / map
16. Place summary
17. Visit detail
18. Settings

### Web
19. Map + visible list + detail panel
20. Place page (gallery, verdict history, dish leaderboard)
21. Filters + saved presets
22. Visit edit / refine (0–10, merge dishes, tag photos, split/join ratings)
23. Want-to-go planning view

---

## 10. Suggested Phasing

**Phase 1 — fix the capture problem (iOS)**
1. One-tap start visit (widget, Control Center, Action Button, Siri, app) with
   nearby restaurant suggestions
2. Live Activity with dish chips and ratings (history-based; placeholder names)
3. Wrap-up and the time-based one-tap verdict prompt
4. Hold-to-talk → cloud AI draft
5. Inbox, including photo-based discovery of forgotten visits
6. Automatic camera-roll photo attachment (copies)
7. memorapp data migration (so history and "same as last time" work from day one)

**Phase 2 — enrichment & the web**
- Menu and receipt reading, photo dish tagging with guesses
- Two-person visits: join visit, joint/split ratings
- Web app: map, filters, place pages, refine
- Want-to-go via share sheet

**Phase 3 — breadth**
- Weekly swipe review, Siri/Shortcuts phrases, Watch
- Additional kinds (trails), once designed

---

## 11. Decisions & Open Questions

### Decided (2026-10-03)

| Question | Decision |
|---|---|
| Do we both have iPhones? | Yes |
| "Always" location for visit detection? | **No.** Visits start with one tap; recovery via photos and receipts |
| Three verdict levels enough at capture? | Yes (no separate "Loved it" level for visits) |
| Per-person or joint verdicts? | **Joint unless we disagree** |
| Guests? | **By name**, remembered for next time |
| Where does AI run? | **Cloud** |
| Trails? | **Deferred.** Manual start when it comes; imports maybe later |
| Photos: copies or Tedography references? | **Copies** |
| memorapp migration? | **Everything that makes sense**; rating mapping in §8 |

### Still open
1. Should joint/split also apply to **dish** ratings, or should each dish belong
   to whoever ordered it? (Draft assumes joint unless we disagree, same as
   verdicts.)
2. Default timing of the one prompt — 90 minutes after start? Different for
   lunch vs. dinner?
3. Should the photo-based discovery also suggest **want-to-go places we passed**,
   or only visits?
4. AI cost ceiling — is a few dollars a month fine?
5. Who can see what — is everything shared between Ted and Lori, or are there
   private notes?

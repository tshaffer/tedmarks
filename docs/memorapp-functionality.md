# memorapp — Functional Specification (As Built)

> Reference document for **Tedmarks**. Describes what the existing memorapp
> (repo: `memorapper`, last commit 2025-07-19) does from a user's point of view.
> It documents behavior as it actually exists, including gaps and quirks, so we
> can decide what to keep, change, or drop. Implementation details appear only
> where they explain behavior.

---

## 1. Purpose

memorapp is a single-user, map-centric app for **remembering restaurants** (and,
to a lesser extent, other places). It supports two phases of a place's life:

| Phase | Question it answers | Data captured |
|---|---|---|
| **Before visiting** ("want to go") | *Why did I save this place?* | Interest level, preview notes |
| **After visiting** | *Was it good? What did I order?* | Overall rating, review text, per-visit dish ratings |

Places are found via Google Places, shown on a map with type-specific icons,
filtered (distance, type, visited status, opening hours), and opened in a
detail panel with Google info plus the user's own notes and visit history.

There are no user accounts, no sharing, and no offline support.

---

## 2. Core Concepts

### 2.1 Place

Every saved place is a Google Place plus the user's own data.

**From Google (snapshotted when the place is added, never refreshed):**
- Name, formatted address, address components (used to derive city)
- Location (lat/lng) and viewport
- Website
- Opening hours (weekly periods + human-readable weekday text)
- Google rating and number of ratings
- Price level, UTC offset, vicinity

**User-entered:**
| Field | Meaning | Scale |
|---|---|---|
| Place type | Restaurant, Grocery Store, Accommodations, Other ("Destination") | enum |
| Interest level | How much I want to go (pre-visit) | 0–10, shown as 5 stars w/ half stars |
| Preview | Free-text notes on why it's interesting (pre-visit) | text |
| Rating | Overall verdict (post-visit) | 0–10 |
| Review | Overall free-text review (post-visit) | text |

**Restaurant-only attributes ("restaurant specs"):**
- Restaurant type: Restaurant, Café, Bar, Bakery, Taqueria, Pizza, Italian,
  Dessert/Ice Cream, Seafood
- Serves breakfast / lunch / dinner (checkboxes)

### 2.2 Visit (restaurant review)

Restaurants can have any number of visits. Each visit has:
- **Date of visit**
- **Items ordered** — a list of dishes, each with:
  - Item name
  - Rating (0–10)
  - Comments ("Evaluation")

Visits exist only for restaurants in practice (the review screen lists only
restaurant-type places).

### 2.3 Visited vs. Unvisited

Not stored — **derived**. A place is *visited* if any of:
- Rating > 0
- Review text is non-empty
- It has at least one visit

Visited status drives marker color, hover/detail content, sorting, and filtering.

### 2.4 Ratings

- All user ratings use a **0–10 integer scale**, entered and displayed as
  **5 stars with half-star precision** (each half star = 1 point).
- Google's 1–5 rating is **doubled** for display so everything is on one scale.
- Each rating input has a **"Not Rated"** checkbox (null) and shows a colored,
  labeled band for the current value:

| Rating input | Bands |
|---|---|
| Place rating | 1–3 *Won't return* (red) · 4–7 *Would try again* (yellow) · 8–10 *Would return* (green) |
| Dish rating | 1–3 *Won't order again* · 4–7 *Good* · 8–10 *Excellent* |
| Interest level | 1–5 *Interested* (red) · 6–10 *Very Interested* (green) |

---

## 3. Navigation & Global Layout

- **App bar**: title "MemoRapp", nav buttons, settings gear.
  - Desktop: **Map**, **Places**, **Add Place** (active one highlighted orange).
  - Mobile (≤768px): a single **Home** icon (→ Map). Places / Add Place are not
    reachable from the mobile nav.
- **Settings dialog** (gear): edits the *default filters* (same controls as the
  Filters dialog, §5). Saved to browser localStorage.
- On launch the app:
  1. Loads **all** places from the server.
  2. Loads saved settings and recent locations from localStorage.
  3. Requests the device's location; if denied/unavailable, falls back to a
     hard-coded Palo Alto location.

Routes: `/` and `/map` (Map), `/places` (Places list), `/add-place` and
`/add-place/:id` (Add/Edit Place), `/write-review/:placeId` and
`/write-review/:placeId/:reviewId` (Add/Edit Visit).

---

## 4. Map Screen (home)

The primary screen. Three regions:

### 4.1 Header (location bar)

| Control | Behavior |
|---|---|
| List toggle (chevron) | Show/hide the visible-places list |
| **Use Current Location** button | Recenters the map on the device location |
| **Recent locations** dropdown | Pick a previously searched location to recenter the map |
| **Location search** (Google Autocomplete) | Type any address/city; selecting it recenters the map and **adds it to recent locations** (deduped by label) |
| **Manage Locations** | Dialog listing saved recent locations (alphabetical) with delete buttons |
| **Filters** button (search icon) | Opens the Filters dialog (§5) |

Recent locations are stored per-browser in localStorage.

### 4.2 Map

- Google Map centered on the current map location, default zoom 14.
- **Blue dot** for the device's current location.
- **One marker per place** (after filtering):
  - Icon by type — restaurant subtype icons (pizza, bread, wine glass, burrito,
    spaghetti, ice cream, shrimp, coffee, fork & knife); hotel icon for
    Accommodations; store icon for Grocery; pushpin for Other.
  - **Name label** next to the marker, colored **green if visited, blue if not**.
  - **Hover card**:
    - Visited: name, rating (number + stars), review text.
    - Unvisited: name, interest level, Google rating (×2), preview text.
  - **Click** → opens the Place Detail panel.
- Cmd/Ctrl + / − zooms the map.
- Whenever the map is panned or zoomed, the set of places **inside the visible
  bounds** is recomputed and fed to the list.

### 4.3 Visible Places List

- Shows only places currently visible on the map (desktop: left column, ~15%
  width; mobile: stacked above the map).
- **Sort by**: Name · Distance (from map center location) · Rating · Visited
  first · Unvisited first.
  - "Rating" uses: place rating, else interest level, else Google rating ×2.
- Each row: **Edit** (→ Edit Place), **Delete** (immediate, no confirmation),
  and the place name (click → Place Detail panel).
- Hovering a row highlights that place's marker (shows its hover card).

### 4.4 Place Detail Panel (right-side drawer)

- **Header**: place name, close button.
- **Rating block**:
  - Visited → "Memorapper Rating" (number + stars), review text.
  - Unvisited → interest level, Google rating ×2 with review count, preview text.
- **Address**.
- **Restaurant section** (restaurants with opening hours only):
  - Restaurant type label.
  - **Opening hours**: summary line ("Open now · Closes 9PM" / "Closed · Opens
    11AM"), expandable to the full week.
  - Breakfast / Lunch / Dinner: Yes/No.
- **Website** link.
- **Directions** button — composes an **email** (mailto, hard-coded recipient)
  containing a Google Maps directions link from current location to the place.
  (Workaround for getting directions onto the phone.)
- **Reviews (visits) section**:
  - **+** → Add Visit for this place.
  - Each visit: date, edit and delete (with confirmation) buttons, and its
    items (name, star rating, comments) or "No items recorded."

---

## 5. Filtering

Opened from the Map header's Filters button; the same controls appear in the
Settings dialog as the saved defaults.

| Filter | Options | Notes |
|---|---|---|
| **Distance away** | ½ mile · 1 mile · 5 miles · 10 miles · Any | Measured from the current map location (straight-line) |
| **Place type** | Restaurant · Accommodations · Other · Grocery Store (multi-select) | None selected = all |
| **Restaurant type** | the 9 restaurant types (multi-select) | Only shown when Restaurant place type is checked; only constrains restaurants |
| **Visited status** | Visited and Unvisited · Visited · Unvisited | |
| **Open status** | Not specified · Open now · Open at meals (+ Breakfast/Lunch/Dinner checkboxes) | Only shown when Restaurant is checked. "Open at meals" infers from Google hours: breakfast = opens before 10am; lunch = open spanning 12–2pm; dinner = open spanning 6–8pm |

**Actual behavior quirks (relevant for redesign):**
- On entering the Map, only the **distance** filter from saved settings is
  applied. The full filter set is applied (server-side) only after pressing OK
  in the Filters dialog.
- Filters chosen in the Filters dialog are **not persisted**; they're lost on
  navigation/reload.
- Place-type / restaurant-type checkboxes don't reflect previously saved
  selections when the dialog reopens.
- "Open now" is evaluated server-side against server time, not the place's
  local time.
- A free-text "query" field exists in the data flow but there is no UI for it
  (remnant of an earlier natural-language search design).

---

## 6. Places Screen (list of all places)

- Table of **all** saved places (not filtered), sorted alphabetically.
- Columns: Edit · Delete · Name · Location (city from Google address, or
  "Not provided").
- Edit → Edit Place. Delete → immediate, no confirmation.
- No search, sort options, or filtering on this screen.

---

## 7. Add / Edit Place Screen

Title: "Add Place" or "Edit Place". A single scrolling form:

1. **Name** — Google Places Autocomplete. Selecting a result captures the Google
   snapshot (§2.1). When editing, the name field is disabled (can't re-link to a
   different Google place).
2. **Restaurant Type** (restaurants only).
3. **Interest Level** — rating input (pre-visit).
4. **Preview** — multiline text (pre-visit).
5. **Meal Availability** — Breakfast/Lunch/Dinner checkboxes (restaurants only).
   **Auto-filled** from Google opening hours when a place is selected.
6. **Rating** — rating input (post-visit).
7. **Review** — multiline text (post-visit).

**Add Place / Save Changes** button (disabled until a Google place is chosen).

Notes:
- There is **no Place Type selector** on the form; new places default to
  **Restaurant**. Other place types exist in the data/filters/icons but can't be
  chosen in the UI.
- Pre-visit and post-visit fields are all shown together regardless of status.
- Adding a place that already exists (same Google place) fails.
- Editing depends on navigation state passed from the list/map; reloading the
  edit URL directly loses the place data.
- After saving, the user stays on the form (no navigation back).

---

## 8. Add / Edit Visit Screen ("Write Review")

Reached from the Place Detail panel (**+** for new, edit icon for existing).

**Top card (place-level):**
- **Restaurant selector** — dropdown of all restaurant-type places
  (pre-selected when coming from the detail panel).
- **Place rating** — rating input.
- **Review text** — the place's overall review.

**Visit card:**
- **Items ordered** — repeating group: Menu Item, dish rating, Evaluation
  (comments). **Add Menu Item** appends a row. (No way to remove a row.)
- **Date of Visit** — date picker, defaults to today.

**Add Review / Save Changes** — sticky button at the bottom. On save, returns
to the Map.

Behavior notes:
- Adding a visit also saves the place-level rating/review edits.
- Editing an existing visit saves **only** the date and items; place
  rating/review changes made on that screen are discarded.
- A just-added visit can't be edited/deleted until the app reloads.
- Visit dates can display one day early in the detail panel (UTC vs. local).

---

## 9. Persistence & Sync

| Data | Where |
|---|---|
| Places, Google snapshots, visits | Server (MongoDB) — two collections: Google snapshot (`mongoPlaces`) and user data (`mrplaces`), joined by Google Place ID |
| Default filters (settings) | Browser localStorage |
| Recent/saved locations | Browser localStorage |

- All places are loaded once at app start; edits update the in-memory copy and
  are sent to the server (optimistic, minimal error handling).
- Deleting a place deletes both its user data and its Google snapshot.
- Google data is never refreshed after the place is added (hours, ratings can go
  stale).

---

## 10. External Integrations

| Service | Use |
|---|---|
| Google Maps JavaScript API | Map display, advanced markers |
| Google Places Autocomplete (client) | Picking a place when adding; searching map locations |
| Browser Geolocation | Current location, blue dot, distance origin, directions origin |
| Email (mailto) | Directions handoff |
| OpenAI | Only in a health-check endpoint; no user-facing feature (vestigial) |

---

## 11. Vestigial / Unused

- Natural-language query/search UI (component exists, not wired up).
- `Write Review` top-level nav item (commented out).
- Map deep-link `/map/:id`.
- Place types Grocery / Accommodations / Other: modeled, iconified, and
  filterable, but not selectable when adding a place.
- Earlier designs (per test data): free-text reviews with restaurant name and
  location, presumably parsed by an LLM.

---

## 12. Observations for Tedmarks

Not decisions — prompts for the functionality discussion:

1. **Generalize the place type.** memorapp's restaurant-specific pieces
   (subtype, meal times, dish-level visit items, meal-based open filter) map to
   type-specific attributes and visit contents (e.g., trail: length, elevation,
   difficulty; visit: conditions, duration, companions).
2. **Pre-visit vs. post-visit** is a strong, general concept worth keeping and
   making explicit (status: want to go → visited), rather than derived.
3. **Rating scale + labeled bands** works well and generalizes; band labels may
   be type-specific.
4. **iOS = fast entry**: add place, log visit, rate items, quickly — likely
   on-site, possibly offline, possibly with photos.
5. **Web = browse & plan**: map, filters, lists, detail, editing.
6. Things memorapp lacks that may matter: search by name, tags, photos,
   refreshable Google data, saved filter presets, real directions handoff,
   confirmation on deletes, undo, multiple ratings per visit (not just per dish).

/**
 * Help topics (Figma W8): the website's Help page lists them, and its Ask box answers questions
 * from them (Claude, on the server, is given exactly these). Markdown bodies; ### for subheadings.
 */
export interface HelpTopic {
  slug: string;
  title: string;
  category: HelpCategory;
  /** Extra words the topic filter matches. */
  keywords: string[];
  body: string;
}

export const HELP_CATEGORIES = ['Basics', 'Recording', 'Planning', 'Tidying up', 'The iPhone app', 'Account'] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export const helpTopics: HelpTopic[] = [
  // ─── Basics ────────────────────────────────────────────────────────────────
  {
    slug: 'getting-started',
    title: 'Getting started',
    category: 'Basics',
    keywords: ['about', 'overview', 'introduction', 'memorapp', 'what is tedmarks', 'phone', 'website'],
    body: `Tedmarks remembers the restaurants we go to, what we ordered there, and what we thought — so next time we know what to order, and when we're somewhere new we can find a place to eat.

It has two halves:

- **The iPhone app** is for **at the restaurant**: start a visit, add what you ordered, rate each dish, and answer "Would you come back?" at the end.
- **The website** is for **at a desk**: plan where to eat on a trip, look back at visits, add visits and menus after the fact, and tidy things up.

Everything is shared between Ted and Lori. The places, visits and dishes from **memorapp** were brought over when Tedmarks started.

### The website's pages

- **Map** — our places and Google's restaurants on a map, for choosing somewhere to eat.
- **Places** — every place in Tedmarks as a list.
- **Visits** — every visit, newest first.
- **Help** — this page.`,
  },
  {
    slug: 'the-map',
    title: 'The map',
    category: 'Basics',
    keywords: ['map', 'home', 'panel', 'list', 'search', 'town', 'city', 'google', 'restaurants', 'search this area', 'trip', 'pins', 'legend', 'directions', 'show these on the map', 'next area'],
    body: `The Map is the website's home page: a list on the left, the map in the middle, and the chosen place in a panel on the right. It shows our places and Google's restaurants together, so you can plan where to eat somewhere you'll be.

### Finding somewhere to eat

1. **Search a town** in the box at the top ("Santa Barbara"). The map moves there and looks for Google's restaurants right away. Searching a restaurant's name opens it instead.
2. **Narrow it with the filters** in the left panel — see *Search filters*.
3. **Choose a restaurant** — a pin or a row in the list — to see it in the panel.

Google's restaurants are only looked up when you ask: **Find Google's restaurants here**, or **Search this area** after moving the map. The button is highlighted again when the map has moved or Google's filters changed. "Google has more — zoom in or narrow the filters" means there were more than one search returns.

**Been there / Want to go / Google** at the top of the list choose which kinds of places are shown. Places we already have show as ours, not Google's.

### The list and the panel

The list shows what's in the map view: our places nearest the center first, then Google's restaurants best rated first, with type, price, city, distance, and whether they're open now.

- **Our places** show our verdict, what to order, the visits, Google's rating and hours, **Directions ↗**, and **+ Add a past visit**, **Menu**, want to go, and **Place page ›**. **On Google ▸** opens Google's own card.
- **Google's restaurants** show Google's card (photos, hours, reviews) with **★ Save as want to go**, **Add a menu** and **Add a past visit**.

### Pins

- **Been there** — a round pin with our verdict (👍 👌 👎), or a grey **?** when there's no verdict yet.
- **Want to go** — a purple ★ (☆ for Curious).
- **Google's restaurants** — grey pins with Google's rating (4.6).
- Zoomed in, our places' names show beside their pins where there's room. The legend at the bottom left explains them.`,
  },
  {
    slug: 'places',
    title: 'Places',
    category: 'Basics',
    keywords: ['places', 'list', 'table', 'sort', 'search', 'last visit', 'most visits', 'nearest', 'recently saved', 'place page', 'hours', 'review', 'refresh from google', 'show on the map', 'areas'],
    body: `**Places** lists every place in Tedmarks, with the same filters as the map.

- **Search** finds places by name, dish, tag or city.
- **Been there / Want to go** choose which to list.
- **Sort:** Last visit, Name, Our 0–10, Most visits, Nearest, or Recently saved. Click a column heading to sort by it; click again to reverse.
- The 📍 on a row shows that place on the map.

**Show these on the map ›** takes the places listed to the map. When they're spread out — say Bend and Golden — the map shows one area at a time, named by its most common city, with **Next area** to move on.

### A place's page

Click a row (or **Place page ›** on the map) for everything about a place: our **verdict**, **What to order**, the **visits**, our **review** and **tags**, any want-to-go note, **hours** from Google, and the latest **menu**. **Refresh from Google** updates its hours, rating, address and type. **Edit place**, **Merge dishes…** and **Delete place** are here too. **Back to the map** returns with this place chosen.`,
  },
  {
    slug: 'visits',
    title: 'Visits',
    category: 'Basics',
    keywords: ['visits', 'history', 'year', 'who', 'city', 'not rated yet', 'not finished', 'most visited', 'stats', 'search visits'],
    body: `**Visits** lists every visit, newest first, grouped by month.

- **Search** by place, dish, who was there, or a note.
- **Filters:** the year (or All time), **Who** was there, **Verdict**, **City**, and **Not rated yet** (a dish or the verdict still to rate).
- **Click a visit** to open it in place: each dish with its rating and notes, the verdict, and the visit's notes, with **Edit** and **Delete**. **Place ›** goes to the place's page.

On the right: how many visits and places that year (and new places tried), the **Most visited** places, and **Not finished** — visits still to rate, with **Show them ›**.

**+ Add a past visit** asks which restaurant (one of ours or any on Google), then opens the visit form.`,
  },

  // ─── Recording ─────────────────────────────────────────────────────────────
  {
    slug: 'adding-a-past-visit',
    title: 'Adding a past visit',
    category: 'Recording',
    keywords: ['add a past visit', 'edit visit', 'visit form', 'order', 'menu', 'stepper', 'quantity', 'x2', 'date', 'who was there', 'guest'],
    body: `**+ Add a past visit** (on a place, a Google restaurant, or the Visits page) records a visit after the fact. **Edit** on a visit opens the same form.

- **Date** — visits are recorded by date.
- **Who was there** — Ted and Lori, plus any guests (type a name to add one).
- **The menu, on the left** — dishes ordered here before (with our last rating and when), then the latest menu by section. **+** adds a dish to the order; **+** again makes it ×2; **−** takes one off. Search the menu if it's long, or add **something not on the menu** at the bottom.
- **Your order, on the right** — each dish with its rating and a note. A dish ordered twice is still rated once.
- **Would you come back?** — the verdict, and notes about the visit.

Saving a visit to a Google restaurant adds it to Tedmarks as **been there**; a want-to-go place becomes been there too.`,
  },
  {
    slug: 'ratings-and-verdicts',
    title: 'Ratings and verdicts',
    category: 'Recording',
    keywords: ['rating', 'verdict', 'would return', 'try again', "won't return", 'loved', 'good', 'skip', 'disagree', 'us', 'ted', 'lori', 'joint', 'what to order', 'order again', '0-10', 'refined rating'],
    body: `Tedmarks keeps two kinds of rating: each dish we ordered gets 😍 loved it, 👍 good, or 👎 skip it; each visit gets a verdict — 👍 would return, 👌 try again, or 👎 won't return. A place's verdict is from its latest visit with one.

### Joint unless we disagree

Most of the time one rating speaks for both of us ("Us"). When we don't agree, rate each person separately (Ted / Lori in the visit form, or on the phone). Tedmarks shows one rating when everyone's is the same, and both side by side (↔ Ted 👎 · Lori 😍) when they differ.

### What to order

On a place, What to order lists every dish once, grouped by its most recent rating: Order again, We disagree, Skip, Not rated. ×2 means we ordered it on two visits. Dishes no longer on the latest menu are greyed.

### Our 0–10

Places brought over from memorapp keep their 0–10 score; it shows next to the verdict.`,
  },
  {
    slug: 'notes',
    title: 'Notes',
    category: 'Recording',
    keywords: ['note', 'notes', 'comment', 'review', 'our review', 'dish note', 'visit note'],
    body: `Three kinds of notes, for three things:

- **A dish's note** — about that dish on that visit ("ask for extra bread"). Add it beside the dish in the visit form, or on the phone when rating it or from Wrap up (tap the dish's name). Dish notes show under the dish in What to order.
- **A visit's notes** — anything that isn't about one dish: the service, the room, the occasion, who was there. At the bottom of the visit form, or in Wrap up on the phone.
- **Our review** — what we think of the place overall. In **Edit place** (website or phone); it shows on the place.

Notes are searchable on the Visits page. A voice note on the phone can add notes too — see *Voice notes*.`,
  },

  // ─── Planning ──────────────────────────────────────────────────────────────
  {
    slug: 'want-to-go',
    title: 'Want to go',
    category: 'Planning',
    keywords: ['want to go', 'save', 'try', 'wishlist', 'curious', 'really want to go', 'want to go back', 'purple', 'star', 'interest', 'why'],
    body: `Save a restaurant you'd like to try so it shows up when you're nearby.

- **On the website:** choose a Google restaurant, then **★ Save as want to go**. Pick **★ Really want to go** or **☆ Curious**, and say why (a dish, who recommended it…).
- **On the phone:** Places → **Save a place to try**, search for the restaurant (include the town for places farther away), then how much and why.

Want to go places are **purple** everywhere: a purple ★ (☆ for Curious) on the map and in lists.

**Want to go back:** for a place we've already been, **★ Want to go back** keeps it as been there and adds why we'd return.

The purple box on a place shows how much and why, with **Edit** and **Delete**. Delete removes a want-to-go place entirely; for a been-there place it only removes the wish to go back.`,
  },
  {
    slug: 'search-filters',
    title: 'Search filters',
    category: 'Planning',
    keywords: ['filter', 'filters', 'when', 'open now', 'meal', 'breakfast', 'lunch', 'dinner', 'cuisine', 'price', 'verdict', 'tags', 'google rating', 'reviews', 'clear'],
    body: `The map and the Places page share one set of filters, and they're remembered.

**How they combine:** choices *within* a filter are either/or (Mexican **or** Italian); *different* filters must all match (Mexican or Italian, **and** open for breakfast on Saturday).

- **When** — Any time, Open now, or **open for a meal on a day** (Today or a day this week, then Breakfast, Lunch or Dinner) for planning ahead. It uses Google's hours; for places without hours, the meals you've set in Edit place.
- **Cuisine** — from the places in view, plus common cuisines. "Not set" finds our places without one.
- **Price** — $ to $$$$, from Google.
- **Our verdict** — Would return, Try again, Won't return, We disagree, or No verdict yet. Our places only.
- **Tags** — our own labels. **Manage tags…** at the bottom renames or deletes a tag everywhere.
- **Google rating** (map only) — a minimum rating and number of reviews, so a 5.0 from three reviews doesn't win. Google's restaurants only.

**Clear** resets the filters (not Been there / Want to go / Google). The place you've chosen always stays shown, even if it doesn't match.`,
  },
  {
    slug: 'menus',
    title: 'Menus',
    category: 'Planning',
    keywords: ['menu', 'pdf', 'screenshot', 'photo', 'read menu', 'claude', 'newer menu', 'delete menu', 'sections', 'prices', 'not on the latest menu'],
    body: `A place's menu is kept as its **list of dishes**, by section, with prices — read by Claude.

**Add a menu** on a place, or on a Google restaurant (which saves it to Tedmarks). Drop a **PDF**, or photos or screenshots of the pages in order, then **Read menu**. A long menu can take a minute or two. The files aren't kept. On the phone, see *Menu camera*.

**Menu** on a place shows the latest one. **Add a newer menu** when it changes: dishes we've had that aren't on the new one show as "not on the latest menu". **Delete this menu** removes it (with Undo).

Menus make ordering a tap — in the visit form here, and in What did you order? on the phone.`,
  },

  // ─── Tidying up ────────────────────────────────────────────────────────────
  {
    slug: 'merge-dishes',
    title: 'Merge dishes',
    category: 'Tidying up',
    keywords: ['merge', 'duplicate', 'same dish', 'dish names', 'clean up', 'not the same', 'aliases'],
    body: `The same dish can end up under two names ("Margherita" and "Margherita Pizza", or a typo), which splits its history: two entries in What to order, each with half the ratings.

**Merge dishes…** on a place's page fixes that. It suggests dishes that **look like the same dish**: choose which name to keep, or **Not the same** to dismiss it. You can also **pick dishes to merge** yourself.

Merging moves every visit's order and rating to the kept dish, so its history is whole, and the other name is remembered so it's recognized later. It can be undone.`,
  },
  {
    slug: 'deleting-and-undo',
    title: 'Deleting and Undo',
    category: 'Tidying up',
    keywords: ['delete', 'undo', 'remove', 'deleted by mistake'],
    body: `Wherever something can be edited, it can be deleted — visits, places, menus, reviews, want-to-go notes, tags.

**Deleting is immediate, with Undo:** instead of asking "Are you sure?" first, a banner at the bottom offers **Undo** for a few seconds. Deleting a place deletes its visits too.

On the phone, swipe a visit or place to delete it.`,
  },
  {
    slug: 'editing-a-place',
    title: 'Editing a place',
    category: 'Tidying up',
    keywords: ['edit place', 'name', 'type', 'cuisine', 'review', 'serves', 'meals', 'breakfast', 'been there', 'want to go', 'tags', 'manage tags', 'rename tag'],
    body: `**Edit place** (on a place's page, or Edit on the phone) changes:

- its **name** and **type**,
- **been there** or **want to go**,
- **tags** — our own labels (patio, date night, good for groups) for finding places later with the Tags filter or search,
- **our review**,
- which meals it **serves** (breakfast, lunch, dinner) — guessed from Google's hours; tick or untick to set them yourself, or **Go by Google's hours instead**.

**Manage tags…** (at the bottom of the Tags filter) renames or deletes a tag on every place at once, with Undo.`,
  },

  // ─── The iPhone app ────────────────────────────────────────────────────────
  {
    slug: 'visits-on-the-phone',
    title: 'Visits on the phone',
    category: 'The iPhone app',
    keywords: ['start a visit', 'phone', 'iphone', 'nearby', 'location', 'who is here', 'guest', 'widget', 'discard', 'add dish', 'what did you order', 'rate dish', 'rate for', 'wrap up', 'end visit', 'lock screen', 'live activity', 'notification', 'reminder', 'past visits', 'places tab'],
    body: `### Starting a visit

On the **Visit** tab, **Start a visit** lists the restaurants around you, nearest first — tap the one you're at (or search; **More nearby** looks farther). Choose **Who's here**, adding guests by name, and the visit starts. A **Start visit** widget does it from the Home Screen. How far to look is in **Settings**.

### What did you order?

**Add dish** opens a list like shopping: **Our order** at the top, then dishes **ordered before** here, then the menu by section. Each has **+** and **−** (+ again makes it ×2). Type to search, or to add a dish that isn't listed.

### Rating and wrapping up

**Rate dish** asks "How was the …?" — 😍 👍 👎, with an optional note. **Rate for: Us / Ted / Lori** records one rating for both of us, or one person's.

**Wrap up** at the end: rate anything left, add notes about the visit, answer **Would you come back?**, and **End visit**. If there's no verdict a while after the visit started, one notification asks (how long is in **Settings → Reminder**).

### The Lock Screen

While a visit is going, a **Live Activity** on the Lock Screen asks about the next unrated dish — tap 😍 👍 👎 without opening the app — and then **Would you come back?**, which ends the visit.

### Past visits and places

**Past visits** (on the Visit tab) lists wrapped-up visits by most recent, name, or nearest. The **Places** tab lists our places — been there, want to go, or all — with their details, **Directions**, **Edit**, and **Start a visit here**.`,
  },
  {
    slug: 'voice-notes',
    title: 'Voice notes',
    category: 'The iPhone app',
    keywords: ['voice', 'voice note', 'talk', 'hold to talk', 'dictate', 'inbox', 'draft', 'claude', 'process', 'offline'],
    body: `**Voice note** on a visit: hold to talk ("The burrata was amazing, Lori thought the pizza was soggy, definitely coming back"). The phone turns your words into text, and Claude turns the text into changes — dishes, ratings, notes, the verdict.

**Nothing is saved until you say so.** "Save these?" lists each change with what you said; tap one to leave it out, then apply. **Later** keeps it in the **Inbox**.

The **Inbox** tab holds voice notes waiting for your OK, and ones that couldn't be read when you recorded them (no connection, or Claude unavailable). **Process** sends the words — never the audio — to Claude.`,
  },
  {
    slug: 'menu-camera',
    title: 'Menu camera',
    category: 'The iPhone app',
    keywords: ['snap the menu', 'camera', 'scan', 'from photos', 'menu photo', 'tedmarks album'],
    body: `In **What did you order?**, **Snap the menu** scans the menu's pages with the camera, or **From Photos** picks pictures you've already taken. Claude reads the dishes so you can just tap what you ordered — you can keep going while it reads.

The pages you snap are saved to a **Tedmarks** album in Photos; the server reads them and doesn't keep them. The menu itself (the list of dishes) is shared with the website — see *Menus*.`,
  },
  {
    slug: 'sync',
    title: 'Sync between phone and web',
    category: 'The iPhone app',
    keywords: ['sync', 'syncing', 'offline', 'server', 'sync now', 'last synced', 'lost phone', 'backup', 'conflict'],
    body: `The phone and the website work on the same records, kept on the Tedmarks server: a visit captured on the phone shows up on the website, and a dish merged on the website shows up on the phone.

- **The phone works offline.** It keeps its own full copy and sends changes when it has a connection. **Settings → Sync** shows when it last synced, with **Sync now**.
- **When two changes collide**, the later one wins. Ratings never collide: Ted's, Lori's and "Us" ratings are kept separately.
- **The website** loads everything when it opens and saves each change right away.

Photos aren't synced: they stay in the iPhone's Photos library, and the website doesn't show them.`,
  },

  // ─── Account ───────────────────────────────────────────────────────────────
  {
    slug: 'signing-in',
    title: 'Signing in',
    category: 'Account',
    keywords: ['sign in', 'sign out', 'apple', 'account', 'login', 'log in', 'password'],
    body: `The website uses **Sign in with Apple**. Only Ted's and Lori's Apple accounts are allowed in. You stay signed in on that browser for 90 days, or until you **Sign out** (top right).

The iPhone app doesn't need signing in yet.`,
  },
];

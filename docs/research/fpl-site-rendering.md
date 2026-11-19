# How the FPL site renders its pages

Resolves [#6](https://github.com/rubinnum/haul/issues/6). Investigated 2026-11-20 against the live site, logged out. Sources are the served HTML, the main JS bundle (`/assets/index-DZSbhisR.js`, 2.7 MB) and a Playwright session on the public pages (home, statistics, fixtures, price changes, the player detail sheet, and the logged-out `/transfers` wall). Bundle hashes change on every deploy, so file names below are examples, not stable references.

## Short answer

- fantasy.premierleague.com is a pure client-side SPA. Every route returns the same 11.9 KB HTML shell (`<div id="root"><p></p></div>`); byte-identical for `/`, `/transfers`, `/my-team`, `/statistics`, `/fixtures`, `/statistics/1`.
- Stack: React 19.2.4, React Router 7.9.1, Redux (plain, with `redux-devtools-extension` compose), React Aria Components for widgets, vanilla-extract plus CSS modules for styling, i18next, Sentry 10.x, oidc-client-ts against PingOne for auth. Built with Vite (`type="module"` entry, `modulepreload` links, `/assets/<name>-<hash>.js`).
- Data comes from `fetch('/api/<endpoint>', {credentials: 'same-origin'})` through one Redux thunk helper and lands in the store. The site itself monkey-patches `window.fetch` to add `X-API-Language` and `X-API-Authorization: Bearer <token>` headers.
- Navigation is `pushState` based: the `#root` subtree is never torn down, `window` globals persist, no new navigation entry is created, only the route's API calls fire.
- The most stable DOM hooks are ARIA labels and roles, a handful of hand-written ids (`page-title`, `overlay-portal`, `sheet-title`), and a few `data-testid`s. Class names and element ids are build-hashed or React Aria generated and should not be relied on.
- A content script can read the site's own API responses. Two viable routes: wrap `window.fetch` from a MAIN-world script that runs at `document_start`, or read the Redux store through the React fiber tree. Both avoid refetching; both carry different stability risks, laid out below.

## Rendering model

### HTML shell

Served by openresty behind Fastly. Body:

```html
<header class="js-ism-page"></header>
<main class="ism" id="mainContent">
  <div id="root"><p></p></div>
  <footer class="main-footer js-ism-page"></footer>
</main>
<div id="onboarding"><p></p></div>
<div id="root-dialog"></div>
```

`#root` is the React root (`__reactContainer$...` expando on the element). `header.js-ism-page` and `footer.js-ism-page` are filled by the Premier League "Pulse" bundle from `www.premierleague.com/resources/v1.55.23/`, not by the FPL React app. `#root-dialog` exists in the shell but stayed empty in every observed state; dialogs render into `div#overlay-portal` inside `#root` (see player detail below).

Head includes `<meta ... data-react-helmet="true">`, so titles and descriptions are set client-side per route.

### Framework fingerprints (from the bundle)

| What | Evidence |
|---|---|
| React 19.2.4 | literal `` `19.2.4` `` next to `react-dom`; `__reactFiber$`/`__reactProps$` expandos on nodes; `useSyncExternalStore` |
| React Router 7.9.1 | `window.__reactRouterVersion === "7.9.1"`; `matchRoutes`, `createRoutesFromChildren`, `UNSAFE_` exports; `data-discover="true"` on `<Link>` anchors |
| Redux | `window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__` branch; a `Provider` with a `store` prop 7 fibers deep from the root; state slices listed below |
| React Aria Components | `data-rac=""` on every widget, `react-aria-TableHeader`/`react-aria-TableBody` classes, generated ids `react-aria<seed>-_r_<n>_` |
| vanilla-extract and CSS modules | `vanilla-extract-recipes.esm` chunk; classes like `_7od82s0` (vanilla-extract) and `_link_cbaxd_6` (CSS modules) |
| i18next | UI strings are `t('key', 'English default')`, so the English defaults are in the bundle |
| Sentry 10.74/10.76 | `window.__SENTRY__`, `browserTracingIntegration` |
| oidc-client-ts | `userStore: new WebStorageStateStore({store: window.localStorage})`, `authority: https://account.premierleague.com/as`, `signinSilent` |

### Route table

All app routes are children of a `/:lang` route, so canonical URLs are `/en/transfers`, `/en/my-team` and so on; bare `/transfers` redirects client-side to `/en/transfers`. Relevant leaf paths from the bundle:

```
""                              (home)
transfers
my-team
squad-selection
statistics
statistics/:statName
fixtures
fixtures/:eventId
fixtures/fdr
entry/:entryId/event/:eventId
entry/:entryId/history
entry/:entryId/transfers
team-of-the-week, team-of-the-week/:eventId
leagues/..., the-scout/..., help/..., price-changes, prizes/..., *
```

Nearly all route components are in the main bundle. Only the help pages (`FAQs`, `Rules`, `Terms`, `PatchNotes`, `ReportName`, `WinnerDetails`) are lazy chunks. Pick team, transfers and statistics render without extra network fetches for code.

There is no player detail route. Player detail is a modal sheet opened from any element button (`aria-label="View player information"`); the URL does not change.

## Data fetching

### The fetch helper

One generic thunk does every FPL API call (de-minified names):

```js
async function BA(endpoint, dispatch, actions, init, meta) {
  dispatch(actions.request());
  const res = await fetch(`/api/${endpoint}`, { ...init, credentials: 'same-origin' });
  // ... 204 / content-type handling, 400 parses body into badRequest
  const data = await res.json();
  dispatch(actions.success(meta ? { ...meta, data } : data));
  return data;
}
```

Endpoints referenced in the bundle (all relative to `/api/`):

```
bootstrap-static/            me/                     regions/
element-summary/{id}/        event/{id}/live/        event-status/
fixtures/?event={id}         fixtures/?future=1      fixtures/fdr
entry/{id}/                  entry/{id}/history/     entry/{id}/transfers/
entry/{id}/event/{gw}/picks/ entry/{id}/transfers-latest/
my-team/{entryId}/           transfers/              watchlist/{id}/
dream-team/ , dream-team/{gw}/
leagues-classic/{id}/standings/?... leagues-h2h/{id}/standings/?... leagues-h2h-matches/league/{id}/?page=
stats/price-changes/  stats/most-valuable-teams/  stats/best-classic-private-leagues/
team/set-piece-notes/  entry-update/  entry-create/  entry-autopick/
```

A few calls bypass the helper and use bare `fetch` (`/api/community-wall/`, `/api/adobe-access/`, `/api/entry-image-upload/`, `/api/team/set-piece-notes/`). Nothing uses XHR for FPL data; the `XMLHttpRequest` hits in the bundle are the `whatwg-fetch` ponyfill chunk and Sentry.

Observed per page, logged out:

| Page | Requests on load |
|---|---|
| any | `bootstrap-static/`, `me/`, `regions/` |
| `/en/fixtures` | plus `fixtures/?event=11` |
| `/en/price-changes` (via in-app link) | plus `stats/price-changes/` only |
| player sheet opened | `element-summary/{id}/` plus two `sdp-prem-prod...pulselive.com/api/v1/metadata/...` calls for club and player media |

### The site patches `window.fetch` itself

The bundle does `const { fetch: original } = window; window.fetch = async (...args) => { ... }`. For FPL API URLs it adds `X-API-Language` and, when an OIDC user or the auth cookie is present, `X-API-Authorization: Bearer <access_token>`; on 401/403 it triggers a soft logout. Sentry also instruments fetch.

Consequence for us: by the time a content script at `document_idle` runs, `window.fetch` is already a wrapper, and the site keeps a private reference to the original. Replacing `window.fetch` after the bundle has run has no effect on the site's own calls. Our wrapper has to be installed first (`document_start`, MAIN world); the site's wrapper then wraps ours and everything flows through. Verified in the session: `window.fetch.toString()` starts with `async(...e)=>{let[t,n={}]=e,r=Dpe(t);if(r){yz(t,n,\`X-API-Language\`...`.

### Redux store shape

Reached from `#root` by walking fibers until `memoizedProps.store.getState` exists (7 hops). Slices and their serialised size on the statistics page, logged out:

```
elements 1.77 MB   (byId: 672 players, controls, dialog, fixturesById, eventDataById, historyById, seasonHistoryById)
events   29 KB     regions 23 KB    teams 7.5 KB    game 2.3 KB    chips 1.5 KB
elementStats, elementTypes, phases, leagues, entries, myTeam, squad, player, fixtures, dreamTeams, cup, stats, ui, urls, winners, bootstrap, global
```

`elements.byId[id]` is the `bootstrap-static` element record (`web_name`, `now_cost`, `ep_next`, `form`, `news`, `chance_of_playing_next_round`, price-change projection fields, ...). `elements.dialog` holds the id of the player currently open in the sheet, which is the only place that id is exposed; the DOM of a row or pitch element carries no `data-id`.

## Navigation and injection lifecycle

Verified by setting `window.__haulMarker` on `/en/statistics`, then clicking the in-app `Price Changes` link:

- URL changed to `/en/price-changes`, `document.title` updated, `performance.getEntriesByType('navigation').length` stayed 1, marker survived, `#root > div._1ksll754x` was the same node.
- Only `stats/price-changes/` fired. `bootstrap-static` is fetched once per hard load and then reused from the store.

So a content script runs once per hard load and must handle route changes itself. Three ways to notice them, from most to least robust:

1. `MutationObserver` on `#root` (subtree) and re-run idempotent injection when the target hook appears or disappears. Works for route changes, in-page tab switches, list/pitch view toggles and modal opens, which no URL-based signal covers.
2. `navigation` API (`window.navigation.addEventListener('navigate', ...)`) in Chromium. Catches the router's `pushState`; misses modals and view toggles.
3. Patching `history.pushState`/`replaceState` from the MAIN world plus `popstate`. Same coverage as 2, works in Firefox, but is a second MAIN-world patch to maintain.

The modal sheet is the other lifecycle to handle: it mounts into `#overlay-portal` (inside `#root`) on open and unmounts on close, so anything injected into it is destroyed each time. The observer in option 1 handles it; URL-based signals do not.

The Pulse header and footer are injected by a separate bundle after the React app; don't anchor on them.

## DOM hooks, by stability

Stable (hand-written by the FPL team, present in the bundle as literals):

| Hook | Where | Note |
|---|---|---|
| `#root`, `#mainContent`, `#root-dialog`, `#onboarding` | shell | fixed HTML, safest anchors |
| `h2#page-title` | every page | text is the localised page title (`Stats`, `Fixtures & Results`, `Price Changes`) |
| `div#overlay-portal` | inside `#root` | mount point for dialogs; `section[role=dialog][aria-labelledby=sheet-title]` inside it when open |
| `h1#sheet-title` | player sheet | contains `span._visuallyHidden` "Player Profile:" then first and second name |
| `table[aria-label="Statistics"]` | statistics | React Aria grid; `tbody tr[role=row]`, `td[role=rowheader]` for the player cell, `td[role=gridcell][data-column-index=N]` |
| `table[aria-label="Gameweek history"]` | player sheet | one `tbody tr` per gameweek |
| `table[aria-label="Pick Team List"]` | my-team list view | from bundle (`myTeamTable.pickTeamList`), not observed logged in |
| `table[aria-label="Transfers List"]` | transfers list view | from bundle (`transfersTable.label`) |
| `table[aria-label="Squad List"]`, `table[aria-label="Element List"]` | squad selection / element list | from bundle |
| `[role=group][aria-label="squad pitch action buttons"]` | transfers / squad pitch | from bundle |
| `button[aria-label="View player information"]` | every element (row, pitch shirt, list) | the player-sheet trigger; per-element anchor |
| `[aria-label="Price change progress"]` | pitch overlay | from bundle |
| `button[aria-label="Previous gameweek"]`, `button[aria-label="Next gameweek"]` | fixtures | observed |
| `data-testid`: `fdr-cell`, `fdr-cell-full`, `fdr-cell-empty`, `td-team`, `team-row`, `table`, `table-head`, `table-body`, `element`, `loadMoreSentinel`, `prev-btn`, `next-btn` | fixtures/FDR, set-piece takers, infinite lists | only about 20 test ids exist in the whole app; most pages have none |

Caveat on ARIA labels: they go through i18next, so they change with the user's language (`/:lang`). Anchor on English only if the extension pins or detects `/en/`; otherwise prefer roles and ids, or read the current language from `document.documentElement.lang`.

Unstable (do not use as selectors):

- Every class name: `_7od82s0`, `_1j8cm7vq` (vanilla-extract hashes), `_link_cbaxd_6`, `_pageTitle_1tuf1_1` (CSS-module hashes). They change whenever the stylesheet changes.
- React Aria ids: `react-aria5673137266-_r_1a_`, `data-key="react-aria-13"`, `data-collection=...`. Per-render, per-seed.
- Chunk file names: `/assets/index-DZSbhisR.js`. Per-deploy.
- Text content of cells beyond the player name (depends on the selected stat column).

Nothing in the DOM carries the element id. To map a row or pitch shirt to a player you need either the store (`elements.byId`, match by `web_name` plus team name from the row's visually-hidden span, e.g. "De Cuyper, Brighton"), or the `element-summary/{id}/` request fired when the sheet opens.

## Reading the site's API responses instead of refetching

Content scripts in the isolated world cannot see the page's `fetch`; the two usable paths both need code running in the page's MAIN world (`world: "MAIN"` in MV3 `content_scripts`, or an injected `<script>`).

### Option A: wrap `window.fetch` at `document_start`

Install a wrapper before the bundle runs; clone the `Response`, parse JSON for `/api/` URLs and `postMessage` (or `CustomEvent`) it to the isolated-world script. The site's own wrapper then wraps ours, which is fine: its private `original` becomes our function.

- Pros: gets exactly what the site requests, including authenticated responses (`me/`, `my-team/{id}/`, `entry/.../picks/`) without ever touching the token. Zero extra load on the API. Simple data contract (the public API JSON, which is already what the rest of the project consumes).
- Cons: must run at `document_start` in MAIN world; if it loads late it sees nothing. Sentry also wraps fetch; order between the three wrappers only matters for `Response` body consumption, so always `clone()` before reading. `bootstrap-static` is about 1.5 MB of JSON per hard load that we would parse a second time.

### Option B: read the Redux store through React internals

Walk fibers from `document.getElementById('root')[Object.keys(root).find(k => k.startsWith('__reactContainer'))]` until a `memoizedProps.store` appears, then `store.getState()` and `store.subscribe()`.

- Pros: gives the current state at any time (no need to be there when the request fired), including derived state like `elements.dialog` (which player the sheet shows) and `squad`/`myTeam` while the user edits transfers before saving, which never hits the network. `subscribe` is a free change feed.
- Cons: `__reactContainer$` and `memoizedProps` are React internals; they have been stable across React 16 to 19 but carry no guarantee. Slice names (`elements`, `myTeam`, `squad`) are the site's private reducer names and can be renamed in any deploy. The store is only reachable after first render, so poll or observe for the `__reactContainer$` key.

### Option C: refetch from `/api/` ourselves

Still works for public endpoints from the content script (same origin, cookies sent). Authenticated endpoints need `X-API-Authorization`, which the site reads from the OIDC user in `localStorage` (`oidc.user:https://account.premierleague.com/as:<client_id>` once logged in) or the auth cookie. Doubles API traffic and couples us to the site's auth plumbing. Keep as fallback for data the page did not load.

## Injection strategy options

| Strategy | Where it anchors | Stability | Covers |
|---|---|---|---|
| 1. Shell-level panel | `#mainContent` / `#root` sibling or a fixed-position container | Highest: shell HTML is static | Anything that does not need to sit next to a specific player |
| 2. Page-level, title-anchored | `h2#page-title` plus `location.pathname` match on `/:lang/(transfers|my-team|statistics|fixtures)` | High: id is hand-written; path segments are in the route table | Per-page headers, toolbars, summary strips |
| 3. Table-level | `table[aria-label=...]` with role-based row/cell selectors; `data-column-index` for cells | Medium-high: labels are deliberate but localised | Extra columns or badges in statistics, transfers list, pick-team list views |
| 4. Per-element | `button[aria-label="View player information"]` as the anchor, its closest `tr` or pitch element as the mount | Medium: one label, used everywhere, localised; no player id in DOM so needs Option A or B to resolve the player | Pitch shirts and rows in pitch view, where tables do not exist |
| 5. Player sheet | `#overlay-portal section[role=dialog]`, `h1#sheet-title`, `table[aria-label="Gameweek history"]`; re-inject on each open via MutationObserver; player id from `elements.dialog` or the `element-summary/{id}/` request | Medium: structure is stable, but it unmounts on every close | Player detail augmentation |
| 6. Test-id anchored | `[data-testid=fdr-cell]` and friends | Medium: only exists on fixtures/FDR and a few lists | FDR grid overlays |

Across all of them:

- Mount our UI in a wrapper we own (ideally a shadow root) and only use the site's nodes as insertion points. Insert as a sibling, or into a `td`/`div` that React treats as a leaf container; never replace React-owned text nodes, since React throws when a node it reconciles with a text child has been changed underneath it.
- Make injection idempotent and re-run it from a `MutationObserver` on `#root`; that single mechanism covers route changes, view toggles and modals.
- For data, prefer A (fetch wrapper) for request-shaped data and B (store) for state that never hits the network (unsaved transfers, open dialog). Use C only as fallback.
- Keep a language guard: either restrict to `/en/` or map ARIA labels per language.

## Not verified

- Logged-in DOM of `/en/transfers` and `/en/my-team` (pitch markup, bench, action bar). The hooks listed for them are bundle literals, confirmed to exist, but their rendered structure was not inspected because login was out of scope. Worth a follow-up ticket to capture one logged-in snapshot of each.
- Whether `#root-dialog` is used by any flow (it was empty in all observed states; all dialogs used `#overlay-portal`).
- Firefox behaviour of MAIN-world content scripts (Chromium was used).

# Official FPL API

Research for issue #3. What `fantasy.premierleague.com/api/` exposes, what needs a login, how the site logs in, and when the data moves.

Everything below marked "observed" comes from hitting the endpoints with plain `curl` on 2026-11-20 (season 2026/27, GW10 finished, GW11 deadline 2026-11-21T11:00Z), with no cookies and the default `curl/8.x` user agent. "From the bundle" means read out of the site's own JavaScript (`/assets/index-DZSbhisR.js`). The API has no official docs, so the bundle and the responses are the primary sources. I did not log in, so the authenticated endpoints are described from their unauthenticated error responses, the bundle, and the `Allow` headers they return.

## Summary

- Base URL is `https://fantasy.premierleague.com/api/`. Trailing slash matters.
- Everything a manager can see on another manager's public page is open: bootstrap, fixtures, player summaries, live GW points, entry profile and history, finished-GW picks, transfer history, classic and H2H league standings.
- Four things need a session: `my-team/{id}/` (current squad, selling prices, chips, free transfers), `transfers/` (POST), `entry/{id}/transfers-latest/`, and `leagues-classic/{id}/` (league admin detail). Without a token they return `403 {"detail":"Authentication credentials were not provided."}`.
- The site authenticates with OpenID Connect against `https://account.premierleague.com/as` (authorization code + PKCE, `oidc-client-ts`) and sends the access token on every `/api/` call as `X-API-Authorization: Bearer <jwt>`. The old `users.premierleague.com/accounts/login/` cookie flow is gone; the host no longer resolves.
- No rate limiting or user-agent blocking observed. 120 back-to-back requests, including 40 uncached `entry/` calls, all returned 200. `python-requests` and empty user agents also get 200.
- `bootstrap-static/` is served through Varnish with `max-age=300`. Everything else says `no-cache, no-store` but still comes back with large `Age` headers, so the CDN caches it anyway. `event/{gw}/live/` came back with `Age: 35670` for a finished GW.

## Endpoints

### `bootstrap-static/`

Observed: 200, 1.8 MB, `cache-control: max-age=300, stale-while-revalidate=3600, stale-if-error=3600`, `vary: X-API-Language, Accept-Encoding`. No auth.

Top-level keys and sizes: `events` (38), `teams` (20), `elements` (672 players), `element_types` (4), `element_stats` (26), `chips` (8), `phases` (11), `game_settings`, `game_config`, `contests` (empty), `total_players` (11,304,303).

Things worth knowing per key:

- `events[]`: one per gameweek. `deadline_time`, `deadline_time_epoch`, `is_previous`, `is_current`, `is_next`, `finished`, `data_checked` (bonus and final points confirmed), `average_entry_score`, `highest_score`, `highest_scoring_entry`, `most_captained`, `most_selected`, `most_transferred_in`, `top_element`, `chip_plays`, `transfers_made`, `release_time`, `released`. Note `is_current` stays on the last finished GW until the next deadline passes: today GW10 is `is_current: true, finished: true` and GW11 is `is_next`.
- `elements[]`: the full player table. Identity (`id`, `code`, `opta_code`, `web_name`, `team`, `team_code`, `element_type`), availability (`status`, `news`, `news_added`, `chance_of_playing_this_round`, `chance_of_playing_next_round`, `can_select`, `can_transact`), price (`now_cost` in tenths, `cost_change_event`, `cost_change_start`, plus the newer `price_change_percent`, `price_change_hourly_rate`, `price_change_projections[]`, `price_change_locked_until`, `price_change_calibrating`), ownership and transfers (`selected_by_percent`, `transfers_in_event`, `transfers_out_event`), season totals (`total_points`, `minutes`, `goals_scored`, `assists`, `expected_*`, `defensive_contribution`, `clearances_blocks_interceptions`, `recoveries`, `tackles`, ICT, `bps`, `bonus`), `ep_this`, `ep_next`, `form`, and set-piece order fields (`penalties_order`, `corners_and_indirect_freekicks_order`, `direct_freekicks_order`).
- `teams[]`: `id`, `code`, `name`, `short_name`, `strength`, `strength_attack_home/away`, `strength_defence_home/away`, `strength_overall_home/away`, `pulse_id`.
- `element_types[]`: positions with squad rules (`squad_select`, `squad_min_play`, `squad_max_play`).
- `game_settings` / `game_config.rules`: squad and league rules (`squad_total_spend: 1000`, `squad_team_limit: 3`, `transfers_cap: 20`, `max_extra_free_transfers: 4`, `transfers_sell_on_fee: 0.5`, `league_join_private_max: 30`, `timezone: UTC`).
- `game_config.settings.price_change_deadlines`: a list of the next three price-change instants, all `T00:00:00Z`. Today it reads `["2026-11-20T00:00:00Z","2026-11-21T00:00:00Z","2026-11-22T00:00:00Z"]`. This is the first-party answer to "when do prices change".
- `chips[]`: name, `chip_type` (`transfer` or `team`), `start_event`, `stop_event`, `overrides`. Wildcard 1 runs GW2 to GW19.

`X-API-Language: fr` returned English anyway, so the `Vary` header is there for the translations layer, not for this payload.

### `fixtures/`

Observed: 200, 346 KB, 380 rows, `no-cache, no-store` but `Age: 282`. No auth.

Per fixture: `id`, `code`, `event` (null for unscheduled), `kickoff_time`, `provisional_start_time`, `started`, `finished`, `finished_provisional`, `minutes`, `team_h`, `team_a`, `team_h_score`, `team_a_score`, `team_h_difficulty`, `team_a_difficulty` (FDR, 1 to 5), `pulse_id`, `stats[]`.

`stats[]` is only populated once a match starts. Identifiers observed on a finished fixture: `goals_scored`, `assists`, `own_goals`, `penalties_saved`, `penalties_missed`, `yellow_cards`, `red_cards`, `saves`, `bonus`, `bps`, `defensive_contribution`. Each has `h` and `a` arrays of `{element, value}`.

Filters: `?event=11` gives that GW (10 rows). `?future=1` gives everything not yet started (280 rows today, starting at GW11).

### `element-summary/{element_id}/`

Observed: 200, 18 KB for player 1, `no-cache, no-store`, `Age: 20` to `264`. No auth.

Three arrays:

- `fixtures[]`: the player's remaining fixtures with `event`, `event_name`, `difficulty`, `is_home`, `kickoff_time`, scores.
- `history[]`: one row per GW played this season. Everything in `elements[]` stats but per match, plus `fixture`, `opponent_team`, `was_home`, `round`, `value` (price that GW), `selected`, `transfers_in`, `transfers_out`, `transfers_balance`, `modified`.
- `history_past[]`: one row per previous season with `season_name`, `start_cost`, `end_cost`, season totals, `element_code`.

One call per player, 672 players. Nothing bulk.

### `event/{gw}/live/`

Observed: 200, 478 KB for GW10, `no-cache, no-store` but `Age: 35670` (about 10 hours). No auth. For a GW that has not started (`event/11/live/`) it returns 200 with `elements: []`, not 404.

`elements[]` has `id`, `modified`, `stats` (`minutes`, `goals_scored`, `assists`, ..., `bonus`, `bps`, `total_points`, `in_dreamteam`, `starts`, `played`, `expected_*`, `defensive_contribution`, `clearances_blocks_interceptions`, `recoveries`, `tackles`) and `explain[]`: per fixture, a list of `{identifier, points, value, points_modification}` showing how the points were built.

This is the endpoint to poll during a live GW. Bonus is provisional until `event-status/` says `bonus_added: true` and the event's `data_checked` flips in bootstrap.

### `event-status/`

Observed: 200, no auth. Returns `status[]` with one row per match day of the current GW (`date`, `event`, `bonus_added`, `points`: `"r"` for released) and `leagues: "Updated"` (or `"Updating"` while league tables recalculate). Small, cheap, the right thing to poll to find out whether a GW has been finalised.

### `entry/{entry_id}/`

Observed: 200, 6 KB, `no-cache, no-store`, `Age: 0`. No auth. Any entry id works.

Fields: `id`, `name` (team name), `player_first_name`, `player_last_name`, `player_region_*`, `favourite_team`, `started_event`, `current_event`, `joined_time`, `summary_overall_points`, `summary_overall_rank`, `summary_event_points`, `summary_event_rank`, `last_deadline_bank`, `last_deadline_value`, `last_deadline_total_transfers`, `years_active`, `kit`, `club_badge_src`, `entered_events`, `leagues`.

`leagues` is `{classic[], h2h[], cup, cup_matches[], event}`. Each classic entry has `id`, `name`, `short_name`, `league_type` (`s` system, `x` private), `scoring`, `entry_rank`, `entry_last_rank`, `entry_percentile_rank`, `rank_count`, `admin_entry`, `entry_can_admin`, `entry_can_invite`, `entry_can_leave`, `has_cup`, `cup_league`, `active_phases[]`, `start_event`, `max_entries`, `closed`.

Note `bank` and `value` are "as of last deadline". Current budget after this week's transfers lives behind `my-team/`.

### `entry/{entry_id}/history/`

Observed: 200, no auth. `current[]` is one row per GW this season (`event`, `points`, `total_points`, `rank`, `rank_sort`, `overall_rank`, `percentile_rank`, `overall_rank_percentage`, `bank`, `value`, `event_transfers`, `event_transfers_cost`, `points_on_bench`). `past[]` is one row per previous season (`season_name`, `total_points`, `rank`, `rank_percentage`). `chips[]` lists chips used (`name`, `time`, `event`).

### `entry/{entry_id}/event/{gw}/picks/`

Observed: 200 for a finished GW, 2 KB, `no-cache, no-store` but `Age: 894207` (about 10 days, the CDN is happily serving a stale copy because it cannot change). For the next GW before its deadline it returns `404 {"detail":"Not found."}` with `vary: Cookie`, so the picks for the coming GW are not public until the deadline passes. No auth for finished GWs.

Returns `active_chip` (null or e.g. `bboost`), `automatic_subs[]`, `entry_history` (the same row as in `history/current[]`), and `picks[]` of 15 `{element, position, multiplier, is_captain, is_vice_captain, element_type}`. `multiplier` is 0 for bench, 2 for captain, 3 for triple captain.

### `entry/{entry_id}/transfers/`

Observed: 200, no auth. Flat array of every confirmed transfer this season: `{element_in, element_in_cost, element_out, element_out_cost, entry, event, time}`. Costs are the prices at the time of the transfer, in tenths.

### `entry/{entry_id}/transfers-latest/`

Observed: `403 {"detail":"Authentication credentials were not provided."}`, `vary: Cookie`, `cache-control: ... private`. Needs the owner's session. Presumably the pending transfers for the coming GW.

### `my-team/{entry_id}/`

Observed: 403 without a token, `allow: GET, POST, PUT, HEAD, OPTIONS`. With a junk bearer token (`X-API-Authorization: Bearer bogus`) it returns `401 {"detail": "Not enough segments"}`, which is a JWT parser complaining, confirming the header is read and expected to carry a JWT. Needs the owner's session and only works for your own entry.

I did not log in, so the response shape is unverified here. Community write-ups agree it returns `picks[]` with `selling_price` and `purchase_price`, `chips[]` with `status_for_entry`, and `transfers` with `bank`, `limit`, `made`, `cost`, `status`. Treat that as a hypothesis to confirm with a real session before building on it.

### `transfers/` (POST)

Observed: `allow: POST, OPTIONS`; unauthenticated POST gives 403. The write endpoint for making transfers. No CORS headers on `OPTIONS` from a foreign origin, so it is same-origin only in a browser; a server-side client with a token is unaffected by that.

### `me/`

Observed: 200 without auth, returns `{"player": null, "watched": []}`, `vary: Cookie`, `private`. With a session this is where the site learns which entry belongs to the logged-in user. Useful as a cheap "is my token valid" check.

### Leagues

- `leagues-classic/{league_id}/standings/`: observed 200, no auth, including for a private league (`league_type: "x"`) found via the entry profile. Returns `league` (id, name, `created`, `closed`, `league_type`, `scoring`, `admin_entry`, `code_privacy`, `has_cup`, `cup_league`, `rank`, `start_event`, `max_entries`), `standings` (`page`, `has_next`, `results[]` of 50 with `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `rank_sort`, `total`, `event_total`, `club_badge_src`), `new_entries` (same shape, for joiners not yet ranked), and `last_updated_data`. Pagination is `?page_standings=N` (and `?page_new_entries=N`). `?phase=N` gives the monthly-phase table. League 314 is Overall.
- `leagues-classic/{league_id}/`: 403 without auth. League settings for admins.
- `leagues-h2h/{league_id}/standings/` and `leagues-h2h-matches/league/{league_id}/`: the paths exist (they return a JSON `404 {"detail":"Not found."}` for ids that are not H2H leagues, not an HTML 404). I had no H2H league id to hand so the shape is unverified.
- `league/{league_id}/search-entries/?search=`: from the bundle, searches entries inside a league. Not probed.

### Other open endpoints seen

`dream-team/{gw}/` (200, `{top_player, team[]}`), `team/set-piece-notes/` (200, `{last_updated, teams[].notes[]}`), `stats/most-valuable-teams/` (200), `stats/best-classic-private-leagues/` (200), `regions/` (200). From the bundle only: `adobe-access/`, `community-wall/`, `entry-image-upload/`, `imggen/{..}`. Not found: `element-types/`, `bootstrap-dynamic/`, `event/{gw}/dream-team/`, `entry/{id}/cup/` (404 for this entry, possibly only exists once the cup starts).

## How the site authenticates

All from the bundle unless stated.

1. The SPA uses `oidc-client-ts` with `authority: https://account.premierleague.com/as`, `client_id: bfcbaf69-aade-4c1b-8f00-c1cb8a193030`, `redirect_uri: <origin>/`, `scope: "openid profile email offline_access p1:update:user consent interest"`, `response_type: code` (the library throws unless it is code + PKCE), user stored in `localStorage`. A second `UserManager` with `client_id c2906aae-...` is used for the logout-and-reauth path.
2. The provider's discovery document (observed at `https://account.premierleague.com/as/.well-known/openid-configuration`) lists `authorization_endpoint: /as/authorize`, `token_endpoint: /as/token`, `userinfo_endpoint: /as/userinfo`, `end_session_endpoint: /as/signoff`, PKCE `S256`, and grant types including `authorization_code`, `refresh_token`, and `device_code`. It is a PingFederate/PingOne style server (the `/as/` prefix and `/as/signoff`).
3. The app monkey-patches `window.fetch`. For any request whose URL matches `^(origin)?/api/`, it sets `X-API-Language` and, if it has a user, `X-API-Authorization: Bearer <access_token>`. If there is no OIDC user but a cookie named `ACCESS_TOKEN` exists on `.premierleague.com`, it uses that instead. On a 401 or 403 from `/api/` it logs an auth event and tries a silent renewal.
4. Logout clears `access_token`, `refresh_token`, and `global_sso_id` cookies on `.premierleague.com` and redirects to `/as/signoff`.

So for a third-party client: no cookie jar tricks. You need an OIDC access token for that client id. The practical options are (a) drive the real browser login and lift `access_token` from the SPA's `localStorage` key `user:https://account.premierleague.com/as:bfcbaf69-...`, then use the `refresh_token` against `/as/token` to keep it alive (`offline_access` is in scope, so refresh tokens should be issued); or (b) run the authorization-code + PKCE flow yourself with the site's client id and a `redirect_uri` of `https://fantasy.premierleague.com/`, catching the redirect. Both are unverified here and both lean on a public client id that the PL could rotate. Token lifetime is unknown; the SPA's expiring notification fires 180 to 300 seconds before expiry, which hints at tokens measured in minutes to hours, not days.

The old flow (POST `login`, `password`, `app=plfpl-web`, `redirect_uri` to `https://users.premierleague.com/accounts/login/`, then carry the `pl_profile` cookie) is dead: observed `curl: (6) Could not resolve host: users.premierleague.com`. Any library or blog post that still describes it is out of date.

## Rate limits and client blocking

Observed on 2026-11-20 from a residential IP, sequential requests, no delay:

- 40 x `bootstrap-static/`: all 200 (CDN hit).
- 40 x `entry/20656/`: all 200 (`Age: 0`, so origin hits).
- 40 x `element-summary/{1..40}/`: all 200.
- `bootstrap-static/` with `User-Agent: python-requests/2.31` and with an empty user agent: 200.
- `entry/{id}/` with `python-requests` user agent: 200.

No 429, no Cloudflare challenge, no `Retry-After` or `X-RateLimit-*` headers anywhere. The stack is `openresty` fronted by Google (`via: 1.1 google`) and two Varnish layers. That does not mean limits do not exist; 120 requests is not a stress test, and the PL has blocked abusive scrapers in the past per community reports I could not verify. A polite client should still cache `bootstrap-static/` for its `max-age` (300 s), poll `event-status/` rather than `live/` to detect changes, and spread `element-summary/` crawls out.

## When data changes

- Deadline: `events[].deadline_time` (UTC). After it passes, `is_current` moves to that GW, `entry/{id}/event/{gw}/picks/` goes from 404 to 200 for everyone, and `transfers/` entries for that GW appear.
- Live GW: `event/{gw}/live/` and `fixtures/` (`stats`, `minutes`, `started`, `finished_provisional`) update during matches. Fixture `finished_provisional` flips at full time; `finished` and the event's `data_checked` flip later, after bonus and any stat corrections. `event-status/` reports `bonus_added` per match day and `leagues: "Updating"/"Updated"` while ranks recalculate. Community lore says bonus lands within an hour or two of the last match of the day and `data_checked` the following morning; I did not observe a live GW, and nothing in the API promises a time, so a client should key off the flags rather than the clock.
- Price changes: `game_config.settings.price_change_deadlines` lists the next three instants, all `00:00:00Z` daily (observed). `elements[].price_change_percent`, `price_change_hourly_rate`, `price_change_projections[]` (offset 0, 1, 2 days ahead with `projected_percent` and `likelihood`), `price_change_locked_until`, and `price_change_calibrating` give the site's own forecast, which is new this season and removes most of the need for third-party price predictors. `cost_change_event` resets each GW.
- Injury news: `elements[].news`, `news_added`, `chance_of_playing_*` change whenever the PL updates them, not on a schedule. `bootstrap-static/` is the only place to see them, and it is cached for 5 minutes.
- Ownership and transfers: `selected_by_percent`, `transfers_in_event`, `transfers_out_event` refresh in `bootstrap-static/` on the same 5-minute cache.
- Rank and points for entries: `summary_overall_rank` and league standings update after `event-status/leagues` returns to `"Updated"`.

## Open questions

- Shape of `my-team/{id}/`, `transfers-latest/`, the `transfers/` POST body, and the H2H endpoints. Needs a real session.
- Access and refresh token lifetimes from `account.premierleague.com`, and whether `/as/token` accepts the refresh grant for the public SPA client without a secret.
- Whether the `ACCESS_TOKEN` cookie fallback is a legacy path or still set by some login route.
- Real rate limits under sustained load.
- Whether `entry/{id}/cup/` returns anything once the cup starts.

## Sources

- Observed responses, 2026-11-20, from `https://fantasy.premierleague.com/api/...` via curl, no cookies.
- Site bundle `https://fantasy.premierleague.com/assets/index-DZSbhisR.js` (the hash will change on deploys; grep for `X-API-Authorization` and `account.premierleague.com/as`).
- OIDC discovery: `https://account.premierleague.com/as/.well-known/openid-configuration`.
- Community documentation (unverified for the authenticated parts, consistent with everything observed for the public parts): Frenzel Timothy, "FPL API endpoints explained", medium.com, 2021; the `fpl` Python library (github.com/amosbastian/fpl) docs, whose login code targets the dead `users.premierleague.com` host.

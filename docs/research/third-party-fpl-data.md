# Third-party FPL data sources

Research for [issue #4](https://github.com/rubinnum/haul/issues/4). Checked on 2026-11-20, during the 2026/27 season (GW10 live). Every claim below links to the page it came from; where a site blocked automated fetches, the note says so and falls back to the best available copy.

## Short answer

Most of the gaps the ticket lists are no longer gaps. The official FPL API now carries xG/xA, a price-change predictor, injury news with source links, and suspension-risk flags. Of the third-party candidates, only LiveFPL (top-10k ownership) and the paid API-Football (injuries) are both reachable and legally usable today; Understat is offline, FBref has lost its xG data, FPL Statistics is dead, and Premier Injuries and FotMob forbid or block automated use.

## What the official API already covers

`GET https://fantasy.premierleague.com/api/bootstrap-static/` is public, needs no auth, and is undocumented. Pulled on 2026-11-20, each of the 672 `elements` has these fields (names copied from the response):

| Need | Fields in `bootstrap-static` | Notes |
|---|---|---|
| xG / xA | `expected_goals`, `expected_assists`, `expected_goal_involvements`, `expected_goals_conceded`, and `_per_90` variants | Season totals. Per-fixture values are in `GET /api/element-summary/{id}/` under `history[]` (`expected_goals`, `expected_assists`, ...). Opta-sourced; `opta_code` (for example `p223340`) is on every player. |
| Price-change prediction | `price_change_percent`, `price_change_hourly_rate`, `price_change_projections[]` (`offset`, `projected_percent`, `likelihood`), `price_change_calibrating`, `price_change_locked_until` | New this season. The Premier League's announcement says the page updates every 15 minutes and changes apply at 00:00 UK time, and "the data will always be a guide and doesn't guarantee a price change" ([premierleague.com, 18 Oct 2026](https://www.premierleague.com/en/news/4680462/whats-new-in-202627-fantasy-price-change-predictor)). Example from the pull: N.Jackson at `107.2` with projections `108.0 / 130.0 / 152.0` for offsets 0 to 2. |
| Injury news | `news`, `news_added`, `chance_of_playing_next_round`, `chance_of_playing_this_round`, `status` (`a`, `d`, `i`, `s`, `u`, `n`), `scout_news_link` | `scout_news_link` was set on 65 players in the pull and points at the club's own press page (for example an arsenal.com Arteta update for Saka). |
| Suspension and loan risk | `scout_risks[]` with `property` (`suspension_risk`, `loan_ineligible`), `notes`, `gameweek`, `url` | Set on 21 players in the pull. Example note: "This player currently has 4 Premier League yellow cards and will face a 1-match suspension on receiving their next." |
| Ownership | `selected_by_percent`, `transfers_in_event`, `transfers_out_event`, `selected_rank` | Overall ownership only. No top-10k or effective-ownership figures. |

Terms: the Premier League site terms say the website and app "must not be used in any other way, including for commercial purposes", forbid "creating a database (electronic or otherwise) that includes material downloaded", and give no accuracy guarantee for statistics ([terms](https://www.premierleague.com/en/terms-and-conditions)). They don't name the API or automated access. No published rate limit; community docs say heavy use gets throttled.

The remaining real gap is **top-10k / effective ownership**. Everything else below is a second opinion on data the API already provides.

## Candidates

### Understat (xG/xA)

- **Status: offline.** `understat.com` and `/league/EPL` both return a page whose only text is "We will come back soon" (fetched twice on 2026-11-20). A rival site reports "understat.com has not loaded since 2 November 2026" and that the operators have "not announced anything" ([xgstat.com](https://www.xgstat.com/understat-alternative)). Downstream projects on GitHub opened issues on 2026-11-19 saying the same ([schieraxi #756](https://github.com/tommaso-quatraro/schieraxi/issues/756)).
- **API:** none, ever. Data was embedded in the page as `var playersData = JSON.parse('...')` inside `<script>` tags and scraped from there; see the parser in [vaastav/understat.py](https://github.com/vaastav/Fantasy-Premier-League/blob/master/understat.py).
- **Terms:** the site has no terms-of-use page that could be found. No stated rate limit or auth.
- **Freshness (when up):** updated after each match; no SLA.
- **Id mapping:** no shared key with FPL. The widely used mapping, vaastav's `id_dict.csv`, is built by exact string match of Understat `player_name` against FPL `first_name + ' ' + second_name` and writes `-1` for misses ([understat.py `match_ids`](https://github.com/vaastav/Fantasy-Premier-League/blob/master/understat.py), [DATA_DICTIONARY.md](https://github.com/vaastav/Fantasy-Premier-League/blob/master/DATA_DICTIONARY.md)). That fails on accents, nicknames and `known_name` players. The repo has an `understat/` folder for 2024-25 but none for 2025-26 or 2026-27 (checked via the GitHub contents API on 2026-11-20; repo last pushed 2026-10-22).
- **Verdict: not usable** right now. Even if it returns, it is scraping of undocumented markup with a brittle name-match join, and the official API already carries Opta xG with a stable id.

### FBref / Sports Reference (xG/xA)

- **Status: xG removed.** Sports Reference announced on 20 Jan 2026 that advanced soccer stats were being removed after Opta/Stats Perform terminated its data feed access and required deletion of the data; basic stats remain ([Awful Announcing, 23 Jan 2026](https://awfulannouncing.com/soccer/sports-reference-pulls-advanced-data-agreement-violation-dispute.html); [The IX Sports](https://www.theixsports.com/the-ix-soccer/fbrefs-loss-advanced-stats-womens-soccer-data-accessibility/)). FBref's xG had been Opta's model since 2022, so it was never an independent second opinion on the FPL numbers anyway.
- **API:** none. Sports Reference sells custom datasets instead.
- **Terms and rate limits:** `sports-reference.com/bot-traffic.html`, `data_use.html` and `fbref.com/robots.txt` all returned Cloudflare 403 to both fetch tools used here, which is the policy in action. Indexed copies of the bot page say they block anyone making "more often than twenty requests in a minute", and that offenders are "in jail for up to a day" ([search snippets of sports-reference.com/bot-traffic.html](https://www.sports-reference.com/bot-traffic.html); live page not verifiable from an automated client).
- **Id mapping:** FBref uses its own 8-character hash ids with no FPL or Opta key exposed.
- **Verdict: not usable.** No xG left to take, scraping is explicitly policed, and the site blocks bots.

### LiveFPL (top-10k ownership, effective ownership, price predictions)

- **What it has:** `/top10k` is a server-rendered page listing effective ownership, ownership and live points for every player with EO over 10% in the top-10k sample, plus captaincy, chip usage and triple-captain tables ([livefpl.net/top10k](https://www.livefpl.net/top10k), fetched 2026-11-20). Similar pages exist for other rank tiers and for "elite" managers. `/prices` is a React app.
- **API:** nothing documented. The `/prices` JS bundle references JSON feeds on a sibling host (`livefpl.us/api/prices.json`, `livefpl.us/elite.json`, `livefpl.us/top_transfers.json`, `livefpl.us/planner/all_player_info.json`, and others). These are private app endpoints, not an offered API; they were not pulled for this note.
- **Terms:** no terms, about or API page could be found (`/about` redirects to a 404; `robots.txt` is 404). The site is ad-funded. Nothing grants or forbids reuse in writing, so reuse would rest on goodwill, and an owner-approved feed would need an email to the maintainer ([@LiveFPLnet](https://twitter.com/LiveFPLnet)).
- **Auth and rate limits:** none visible; pages load without login.
- **Freshness:** "live" during gameweeks (the page shows live points against each EO figure). Update cadence is not stated.
- **Id mapping:** the HTML carries `web_name` only (for example `N.Jackson`, `Groß`), no element id. `web_name` is unique within a season in practice but is not guaranteed unique and changes when FPL renames a player. The internal JSON feeds likely carry FPL ids, but that is unverified.
- **Verdict: usable with care, and only for top-10k / EO.** Cheapest path to the one metric the official API lacks. Treat as scraping of a page with no licence; ask the maintainer before shipping anything that depends on it, cache aggressively, and expect markup to change. For price predictions, prefer the official fields above.

### Compute top-10k ownership yourself (alternative to LiveFPL)

The official API exposes the overall league standings (`/api/leagues-classic/314/standings/?page_standings=N`) and each entry's picks (`/api/entry/{id}/event/{gw}/picks/`). Sampling the top 10k is roughly 200 standings pages plus 10,000 picks requests per gameweek, all unauthenticated. This is the approach described in an academic study of FPL skill that pulled standings and then every manager's picks ([arXiv 2009.01206](https://arxiv.org/pdf/2009.01206)). It removes the LiveFPL dependency and id-mapping problem (picks return element ids), at the cost of a long, throttle-prone batch job. Worth a spike if top-10k EO makes the feature list.

### FPL Statistics (price predictions)

- **Status: dead.** `www.fplstatistics.co.uk` and `fplstatistics.com` both present a TLS certificate for an unrelated host (`eduvaultadmin.hbku.edu.qa`), so the domains no longer point at the service. No shutdown announcement was found.
- **Verdict: not usable.** The official predictor and LiveFPL cover the same need.

### Fantasy Football Scout (price predictions, Opta xG, injuries)

- **What it has:** its own [price predictions page](https://www.fantasyfootballscout.co.uk/fpl/price-predictions), a members-only Opta Stats Centre with xG, and daily team-news and injury articles.
- **API:** none.
- **Terms:** "You must not, nor try to, make mass, automated or systematic extractions of Fantasy Football Scout content, or use it to create or include it within another paper or electronic database, or try to re-sell or re-distribute it" ([terms](https://www.fantasyfootballscout.co.uk/terms-and-conditions)). For paid members data: "In most cases, sharing Members data is not allowed"; small amounts may be shared with credit ([members FAQ](https://www.fantasyfootballscout.co.uk/how-to-use-the-members-area)).
- **Verdict: not usable** as a data source. Fine as a link target for humans.

### Premier Injuries (injury news)

- **What it has:** the long-running club-by-club injury table and return dates.
- **API:** none.
- **Terms and access:** every page tried (`/injury-table.php`, `/terms-of-use.php`, `/robots.txt`) returned 403 to automated clients on 2026-11-20, so the site actively blocks scrapers. Its terms could not be read for the same reason.
- **Id mapping:** names only.
- **Verdict: not usable.** The official `news`, `chance_of_playing_*` and `scout_news_link` fields, plus the public Premier League injury page ([premierleague.com/en/latest-player-injuries](https://www.premierleague.com/en/latest-player-injuries), "Last updated: 17:07 GMT, 19 November 2026"), cover this.

### FotMob (xG, lineups, injuries)

- **What it has:** per-match and per-player xG, predicted lineups, injury lists, via an undocumented JSON API that its web app uses.
- **Terms:** prohibit "the use of automatic services (robots, spiders, etc.)" and "other methods for systematic, regular, or bulk retrieval of data", and require "express written consent from FotMob" for use of the data for any purpose beyond personal, non-commercial use ([fotmob.com/tos.txt](https://www.fotmob.com/tos.txt)).
- **Verdict: not usable** without a written agreement.

### API-Football (api-sports.io): injuries, fixtures, player stats

- **API:** yes, documented REST API with API-key auth. The official site says "Our Free plan gives you access to the entire API" and lists injuries among its endpoints; the Free tier is 100 requests/day, paid tiers 7,500 / 75,000 / 150,000 per day ([api-football.com/pricing](https://www.api-football.com/pricing); RapidAPI mirror lists USD 19 / 29 / 39 per month and a 30 requests/minute cap on Free). The pricing and docs pages returned 403 to the fetch tools used here, so the figures come from indexed copies of those pages and should be re-checked in the dashboard before buying.
- **xG:** not confirmed at player level for the Premier League; treat as fixtures and injuries only.
- **Freshness:** injuries endpoint returns the current list; history is not kept (stated for their NFL product, unverified for football).
- **Id mapping:** its own player ids; no FPL or Opta key. A name-and-team join is needed, same weakness as Understat.
- **Verdict: usable, paid, low priority.** Only worth it if the official injury fields prove too slow or too thin. 100 free requests/day is enough for a once-a-day injury pull of 20 teams.

### Sportmonks: xG, fixtures

- **API:** yes, documented. Plans from EUR 29/month (any 5 leagues), xG is a paid add-on from EUR 24/month, rate limit 2,000 to 5,000 calls per entity per hour depending on plan ([pricing](https://www.sportmonks.com/football-api/pricing/)). Player xG is per fixture, "usually range between 0 and 1.5", updated during the match with gaps "not exceed 5 minutes"; season-level player xG is "not yet available" ([xG FAQ](https://docs.sportmonks.com/football/beta-documentation/expected-goals/faq)).
- **Id mapping:** own ids; no FPL or Opta key.
- **Verdict: usable, paid, low priority.** Only justified if an independent xG model is wanted on top of Opta's. Roughly EUR 50+/month for one league.

### xG Stat (Understat replacement)

- Free site covering the Premier League and four other leagues, player xG/xA per 90, Premier League figures computed from "a professional match-event feed". Explicitly "has no data download and no API" ([xgstat.com](https://www.xgstat.com/understat-alternative)).
- **Verdict: not usable** as a feed. Noted because it is where Understat users are going.

## Shortlist

| Source | Adds beyond official API | Access | Terms | Id mapping | Verdict |
|---|---|---|---|---|---|
| Official FPL API | baseline: xG/xA, price predictor, injuries, scout risks | public JSON, no auth | no API terms; site terms forbid commercial use and databases | `id`, `code`, `opta_code` | use as the primary source |
| LiveFPL | top-10k ownership, EO, chips, captaincy | HTML scrape; private JSON feeds exist | none published | `web_name` only | usable with care; ask the maintainer |
| Self-computed top-10k | same as LiveFPL | official API, ~10k requests/GW | as official API | element ids | usable; spike it |
| API-Football | injury list with return dates | REST, API key, 100/day free | commercial API terms | own ids, name join | usable, paid, low priority |
| Sportmonks | independent xG per fixture | REST, API key, paid add-on | commercial API terms | own ids, name join | usable, paid, low priority |
| Understat | independent xG | offline since 2 Nov 2026; was page-embedded JSON | none | name join | not usable |
| FBref | nothing (xG removed Jan 2026) | blocked, 20 req/min policy | scraping forbidden | own ids | not usable |
| FPL Statistics | nothing | domains dead | n/a | n/a | not usable |
| Fantasy Football Scout | editorial injury news, Opta tables | HTML, paywall | automated extraction forbidden | names | not usable |
| Premier Injuries | injury table | 403 to bots | unreadable (403) | names | not usable |
| FotMob | xG, lineups, injuries | undocumented JSON | bulk retrieval forbidden | own ids | not usable |

## Open questions for the feature grilling

1. Is top-10k / effective ownership on the feature list? It is the only item here the official API cannot supply. If yes, choose between LiveFPL scraping (fast, fragile, no licence) and self-computing from picks (slow, clean ids, no third party).
2. Does anything need a second xG model next to Opta's? If not, drop every xG source above.
3. Are the official `news` / `scout_news_link` / `scout_risks` fields fresh enough? Sample them against club announcements for a few gameweeks before paying for API-Football.
4. The official API has no stated rate limit or terms for programmatic use. Decide on a polling cadence and caching policy before any of the above matters.

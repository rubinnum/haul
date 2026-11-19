# Authenticated FPL access outside the browser

Research for issue #12. Question: how can a local process read the owner's own private FPL data (`my-team`: picks before the deadline, transfer state, bank) from fantasy.premierleague.com, and what does each route cost in friction and risk?

Researched 2026-11-20 against the live site, its shipped JavaScript, its terms, PingOne docs and the source of community libraries. No login was performed; the only requests made were unauthenticated probes and deliberately invalid tokens to read error shapes.

## Summary

- FPL login is PingOne OIDC at `account.premierleague.com`. The old `users.premierleague.com` cookie login is gone. Cookies copied from the browser (`pl_profile`, `sessionid`) do not authenticate `api/my-team` any more.
- The web app sends `X-API-Authorization: Bearer <access_token>` on every `/api/` call. The access token is a JWT; the server rejects anything else.
- The browser keeps a refresh token in `localStorage` under `oidc.user:https://account.premierleague.com/as:bfcbaf69-...`. A local process can exchange it at `https://account.premierleague.com/as/token` with the public client id, no secret. Refresh tokens rotate on every use.
- 2FA is an authenticator-app TOTP at interactive sign-in only. It does not touch the refresh grant, but it breaks any scripted password login.
- The FPL game terms (2026/27, clause 28(d)) prohibit using "automated systems to access the Game and extract information from the Game". Sanctions are discretionary and go up to disqualification. A read-only tool on the owner's own account is low risk in practice but is not permitted on paper.

Recommended option: copy the refresh token from the browser once, then run the refresh grant locally and persist the rotated token. Second choice: the owner's own browser session via Playwright against a persistent profile.

## How the site authenticates today

### Identity provider

The fantasy.premierleague.com homepage ships its SSO config inline:

```
sso: {
  authUrl: "https://account.premierleague.com",
  apiUrl: "https://api.pingone.eu/v1",
  environmentId: "68340de1-dfb9-412e-937c-20172986d129",
  clientId: "1f243d70-a140-4035-8c41-341f5af5aa12",   // premierleague.com site client
  pairing2FAClientId: "313a7ebb-...", unpairing2FAClientId: "ff025e81-...",
}
```

`https://account.premierleague.com/as/.well-known/openid-configuration` resolves to a PingOne (EU) authorization server with `authorization_endpoint`, `token_endpoint` (`/as/token`), `userinfo`, `revoke` and `signoff` endpoints. The same environment is reachable at `https://auth.pingone.eu/68340de1-.../as/`. Supported grants include `authorization_code` and `refresh_token`; PKCE `S256` is supported.

Source: `curl https://fantasy.premierleague.com/` (inline `window.PULSE.envPaths`), `curl https://account.premierleague.com/as/.well-known/openid-configuration`.

### The FPL web app's own OIDC client

The main bundle (`/assets/index-DZSbhisR.js` at time of writing) constructs an `oidc-client-ts` `UserManager`:

```
authority: "https://account.premierleague.com/as",
client_id: "bfcbaf69-aade-4c1b-8f00-c1cb8a193030",
redirect_uri: `${window.location.origin}/`,
scope: "openid profile email offline_access p1:update:user consent interest",
automaticSilentRenew: false,
accessTokenExpiringNotificationTimeInSeconds: <random 180..300>,
userStore: new WebStorageStateStore({ store: window.localStorage })
```

Points that matter for us:

- `offline_access` means the browser receives a refresh token.
- The user (tokens and profile) sits in `localStorage` under oidc-client-ts's key `oidc.user:<authority>:<client_id>`.
- The app monkey-patches `window.fetch`: for requests to the FPL API it calls `getUser()`, renews silently if the access token is expired or within the notification window, and sets `X-API-Authorization: Bearer <access_token>`. If no OIDC user exists it falls back to an `ACCESS_TOKEN` cookie on `premierleague.com` (the native app/webview path). On a 401 or 403 from the API it performs a "soft logout": removes the user from `localStorage`, clears the cookie and redirects to `/`.
- Silent renewal is `signinSilent()`, which in oidc-client-ts uses the refresh token grant when a refresh token is present ("use refresh token unless forceIframeAuth is explicitly true").

Sources: FPL bundle (grep for `X-API-Authorization`, `account.premierleague.com`, `signinSilent`); oidc-client-ts `src/UserManager.ts`.

### Server-side behaviour of `api/my-team`

Probed without logging in:

| Request | Response |
| --- | --- |
| `GET /api/my-team/1/` with no credentials | 403 `{"detail":"Authentication credentials were not provided."}` |
| `GET /api/my-team/1/` with `Cookie: sessionid=x; pl_profile=x` | 403 `{"detail":"Authentication credentials were not provided."}` |
| `GET /api/my-team/1/` with `X-API-Authorization: Bearer invalid` | 401 `{"detail": "Not enough segments"}` |
| `POST /as/token` refresh grant with an invalid token | 400 `{"error":"invalid_grant","error_description":"Failed to decode refresh token ..."}` |

"Not enough segments" is a JWT decode error: the API expects a signed JWT access token in that header and does not recognise the legacy cookies as credentials at all. The responses are served by `openresty` behind Varnish/Google; there was no DataDome or Cloudflare challenge on the API host. `account.premierleague.com` is behind Cloudflare (`__cf_bm` cookie) but answered a plain `curl` token request with a normal OAuth error, so the token endpoint is not bot-gated for simple requests.

## Login flow (interactive)

Authorization code + PKCE from the SPA to `/as/authorize`, hosted by PingOne DaVinci. A community PR against the `fpl` Python library (amosbastian/fpl#135, open, Aug 2025) reverse-engineered it: GET `/as/authorize` (client id `bfcbaf69-...`, PKCE S256), scrape an `accessToken` out of the login HTML, POST to `/davinci/policy/<id>/start`, two POSTs to a `customHTMLTemplate` capability with `username`/`password`, POST `/as/resume` with the `dvResponse`, follow the redirect to get `code`, exchange it at `/as/token`. It then calls `api/me/` with `X-API-Authorization`. The flow has no step for a 2FA code, so it only works on accounts without 2FA, and it depends on DaVinci policy and connection ids that the Premier League can change at any time.

## Two-factor authentication

- Premier League accounts support 2FA via an authenticator app (Google, Microsoft, Oracle named). The official page says "each time you log in you will need to enter a one-time password". It can be enabled and disabled under account security settings. Source: premierleague.com/en/two-factor-authentication.
- The July 2025 UI relaunch silently left 2FA off for many users; it has to be turned back on under User Profile > Account security (Fantasy Football Scout, 22 Jul 2025). The bundle's `pairing2FAClientId` / `unpairing2FAClientId` are the PingOne clients for that pairing flow.
- The 2026/27 FPL terms make the player "responsible for maintaining the security of your account credentials (including enabling two-factor authentication where available)".
- Effect on options: 2FA is enforced at the authorization endpoint during interactive login. The `refresh_token` grant at `/as/token` does not involve the user and is unaffected. Scripted password login (option D) fails with 2FA on.

## Token lifetimes

PingOne OIDC application defaults, from Ping's docs:

- Access token: 60 minutes by default (PingOne platform docs). Community observation for FPL specifically: "FPL_API_TOKEN typically expires every ~8 hours" (dexhamter/fpl-mcp). The exact FPL setting is in the token's `exp` claim and the `expires_in` of a token response; neither was observed here. Treat it as 1 to 8 hours and read `expires_in` at runtime.
- Refresh token: default duration 30 days, rolling duration 180 days (range 60 seconds to 1826 days). "Outside of the optional rolling grace period, refresh tokens are intended for one-time use." The rolling grace period is 0 to 86,400 seconds; 0 means the old token is invalid the moment it is rolled. Optional "Additional Refresh Token Replay Protection" revokes both tokens if a rolled refresh token is replayed.
- Both community MCP servers that use the refresh grant confirm rotation in practice: "PingOne rotates refresh tokens on every use, so another process may have already rotated it" (rishijatia/fantasy-pl-mcp `auth_manager.py`); mgphp/fpl-mcp rewrites `FPL_REFRESH_TOKEN` in `.env` after each exchange.
- Consequence: the browser and a local process share one refresh token lineage. Whichever uses it first wins; the other's copy is stale. The browser recovers by redirecting through `/as/authorize` (silent, because the PingOne session cookie is still valid), so the practical symptom is an occasional reload, not a re-login. fantasy-pl-mcp's README describes exactly this: "the first exchange claims the token before your browser session can supersede it ... your browser session recovers on its own."

Sources: docs.pingidentity.com `p1_edit_application_oidc`, developer.pingidentity.com access-tokens page, the two MCP repositories.

## Does a cookie copied from the browser work?

No, not for `api/my-team`. The legacy `pl_profile` + `sessionid` (and later `datadome`) cookie recipe from 2019 to 2023 (Medium guide; amosbastian/fpl#126, #127) stopped working with the PingOne move. A June 2026 comment on amosbastian/fpl#127 reports "Cant find pl_profile in the cookie now. now it has only pl_guest_id", and the probe above shows the API ignores those cookie names. The only cookie the app itself will fall back to is `ACCESS_TOKEN` on `premierleague.com`, which just carries the same JWT as the header, so it buys nothing over copying the token.

What does work when copied from DevTools:

- the `X-API-Authorization` header value from any `/api/` request (an access token; dies within hours), or
- the `refresh_token` field of the `oidc.user:...` localStorage entry (lives for weeks, rotates on use).

## Options

### A. Copy the refresh token once, run the refresh grant locally (recommended)

How: in a logged-in tab, DevTools > Application > Local Storage > `https://fantasy.premierleague.com`, copy the `refresh_token` from the `oidc.user:https://account.premierleague.com/as:bfcbaf69-...` entry (fantasy-pl-mcp's console one-liner: `copy(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('oidc.user:')))).refresh_token)`). Store it in the OS keychain or a mode-600 file. On each run: `POST https://account.premierleague.com/as/token` with `grant_type=refresh_token&client_id=bfcbaf69-aade-4c1b-8f00-c1cb8a193030&refresh_token=...` (no scope parameter; requesting a different scope gives `invalid_grant`), read `access_token`, `expires_in` and the new `refresh_token`, persist the new refresh token before doing anything else, then call `GET https://fantasy.premierleague.com/api/my-team/<entry>/` with `X-API-Authorization: Bearer <access_token>`. Cache the access token until `expires_in` minus a margin. Treat 400 `invalid_grant` as "re-copy from browser".

Friction: one manual copy per 30 days at most (longer if the rolling window applies; shorter if the Premier League revokes sessions or the user signs out, which hits `/as/signoff` and may revoke). Rotation means the stored token must be written atomically and never used from two processes at once; if it is lost mid-rotation the lineage is dead and you copy again. Occasional browser hiccup when the browser's copy goes stale.

Risk: low technical fragility (standard OAuth endpoints, no HTML scraping). Possession of a long-lived refresh token is the main security exposure; keep it off disk in plain text and out of the repo. The Premier League can rotate the client id or lock down the token endpoint without notice. Terms risk as below.

### B. Copy the access token from DevTools

How: copy the `X-API-Authorization` header from a `/api/` request and call `my-team` with it.

Friction: high. The token expires within hours (observed about 8 by one community project; PingOne default is 1), so this is fine for a one-off check and useless for anything scheduled.

Risk: lowest security exposure (short-lived), same terms position.

### C. Drive the owner's browser (Playwright/Chromium with a persistent profile, or a DevTools-attached Chrome)

How: launch a browser with a profile where the owner has signed in once (including 2FA), navigate to `fantasy.premierleague.com`, let the app refresh its own tokens, and either read `localStorage` or intercept `/api/my-team/` responses. lewis-king/fpl-mcp-server does a variant of this (headless Chromium, fills the login form, captures the `/as/token` response).

Friction: a browser dependency (hundreds of MB), slower, and the automated login variant breaks with 2FA on and may trip Cloudflare bot checks on `account.premierleague.com`. The persistent-profile variant avoids both but keeps a full logged-in browser profile on disk, which is a bigger secret than a refresh token.

Risk: moderate fragility (UI and selectors change; the July 2025 relaunch rewrote the app). Same terms position, and more obviously "automated access" if it runs the login form.

### D. Scripted username/password login against DaVinci (amosbastian/fpl#135 style)

How: replay the PKCE + DaVinci policy flow with the owner's credentials.

Friction: fails if 2FA is on (no OTP step exists in the flow and adding one needs the TOTP secret in the script); depends on scraped DaVinci policy/connection ids and HTML; `account.premierleague.com` sits behind Cloudflare. The PR has been open since Aug 2025 and the `fpl` library itself was last pushed July 2024, so there is no maintained implementation.

Risk: highest. Stores the password, bypasses 2FA, and is the pattern the Premier League's own FAQ warns about ("sharing their FPL login credentials ... with third-party websites or applications puts the security of their FPL team at risk"). Not recommended.

### E. Public endpoints only (no auth)

`GET /api/entry/<id>/`, `/api/entry/<id>/event/<gw>/picks/`, `/api/entry/<id>/transfers/`, `/api/entry/<id>/history/` are public and return bank and value after each deadline, and the picks for finished or current gameweeks. They do not return the pre-deadline draft squad, pending transfers or current free-transfer count; `my-team` is the only source for those. Zero friction, zero account risk, but it does not answer the ticket's question for pre-deadline state.

## Community library status (verified)

| Library | Private endpoints | Status |
| --- | --- | --- |
| `fpl` (amosbastian, PyPI) | Legacy cookie/password login; broken since the PingOne move. PR #135 (token login) open, unmerged. Repo last pushed July 2024. | Not usable for auth as published |
| `fpl-api` (npm, jeppe-smith) | "Private endpoints that require a session are not implemented yet" | Public data only |
| `fantasy-pl-mcp` (rishijatia, Python) | Refresh-token grant, `X-API-Authorization`, encrypted token store, handles rotation | Working reference implementation of option A |
| `fpl-mcp` (mgphp, TypeScript) | Same approach; rewrites `.env` on rotation | Working reference implementation of option A |
| `fpl-mcp` (dexhamter) | Manual access-token paste, notes ~8 hour expiry | Option B |
| `fpl-mcp-server` (lewis-king, Python) | Playwright login, captures `/as/token` | Option C, no 2FA support |
| `ex_fpl` (Elixir), `fantasy` (R) | Documented against the old cookie flow | Stale |

None of these is an official SDK. The FPL API is undocumented and has no published terms of its own.

## Terms of service

Two documents apply.

**2026/27 Fantasy Premier League Terms & Conditions** (`fantasy.premierleague.com/help/terms`, rendered from the `Terms-*.js` chunk):

- 6: "only one Registration for the Game per user ... Individuals are not permitted to provide any other person with access to their account".
- 27: keep passwords secure and confidential; do not allow any other person access to your account.
- 28: "You also warrant and agree that you shall not: ... (b) ... exploit any information or other material obtained through the Game for commercial purposes ...; (c) engage in spamming or flooding; (d) use automated systems to access the Game and extract information from the Game; (e) attempt to gain unauthorised access to other computer systems through the Game".
- 29: the Premier League owns all IP in the Game "and any Game data"; players may not reproduce or distribute it except as permitted.
- 31(d): players are responsible for credential security "including enabling two-factor authentication where available".
- 36: on breach the Premier League may refuse entry, disqualify, modify, delete or suspend the Registration, or delete related information; "All such decisions ... will be final".

**premierleague.com Terms of Use** (site-wide): no explicit bot or scraping clause; prohibits creating a database from downloaded material, commercial reuse, and attempting unauthorised access. Governed by the laws of England and Wales.

**Official FAQ, "Account Security"** (premierleague.com/en/about/faq/account-security): "We have never condoned or endorsed the use of third-party websites or applications to aid FPL team management", and sharing FPL credentials with third parties "puts the security of their FPL team at risk".

Reading for this project: clause 28(d) is written broadly enough to cover any script that calls the API, authenticated or not. There is no API licence that carves out personal use. In practice the Premier League has not enforced it against the large ecosystem of personal tools and open-source wrappers that have existed for years, and enforcement is at their discretion with no appeal. A read-only tool that uses the owner's own session, calls `my-team` a handful of times a day, stores nothing of other users, and does not share or sell the data is about as low on the risk curve as automated access gets. Options that store the password or bypass 2FA (D, and C's login variant) sit much closer to the credential-sharing clauses the Premier League actually talks about. Nothing here is legal advice.

## Open items

- Actual `expires_in` for the FPL access token, and whether FPL enables a refresh-token rolling grace period. Both are visible from a single token response once the owner tries option A.
- Whether `/as/signoff` (browser sign-out) revokes outstanding refresh tokens. PingOne can; FPL's configuration is unknown.
- Whether the Premier League rate-limits `my-team` per token. No rate-limit headers were seen on unauthenticated probes.

## Sources

Primary:

- `https://fantasy.premierleague.com/` inline SSO config, `/assets/index-DZSbhisR.js` (OIDC client, fetch patch), `/assets/Terms-DUOzP1QV.js` (2026/27 terms), fetched 2026-11-20
- `https://account.premierleague.com/as/.well-known/openid-configuration`
- `https://fantasy.premierleague.com/api/my-team/1/` and `/api/me/` unauthenticated probes
- `https://www.premierleague.com/en/two-factor-authentication`, `https://www.premierleague.com/en/about/faq/account-security`, `https://www.premierleague.com/terms-and-conditions`
- PingOne docs: `docs.pingidentity.com/pingone/applications/p1_edit_application_oidc.html`, `p1_refresh_tokens.html`; `developer.pingidentity.com/pingone-api/foundations/authentication-concepts/access-tokens-and-id-tokens.html`
- oidc-client-ts `src/UserManager.ts` (signinSilent, user store key)

Community (code read, not just READMEs):

- rishijatia/fantasy-pl-mcp: `README.md`, `src/fpl_mcp/config.py`, `src/fpl_mcp/fpl/auth_manager.py`
- mgphp/fpl-mcp: `README.md`, `.env.example`, `src/fplClient.ts`
- amosbastian/fpl: PR #135 diff, issues #127, PR #126
- lewis-king/fpl-mcp-server `src/fpl_server/auth.py`; dexhamter fpl-mcp listing on glama.ai
- jeppe-smith/fpl-api npm page
- Fantasy Football Scout, "FPL 2025/26: How to turn two-factor authentication (2FA) back on", 22 Jul 2025

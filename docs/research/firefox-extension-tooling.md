# Extension tooling for Firefox and Zen (MV3, TypeScript)

Resolves GitHub issue #5. Researched 2026-11-20 against MDN, Extension Workshop, the WXT docs, the Plasmo docs, the Zen Browser docs and repo, and a local Zen 1.24.1b install on macOS.

## Recommendation

Use WXT (v0.21.5) with `web-ext` as the dev runner, targeting Firefox MV3 explicitly with `wxt dev -b firefox --mv3`. Write against the `browser.*` promise API with no polyfill. Keep the Firefox build as a background event page (`background.scripts`), not a service worker. Zen needs no code changes; it needs one line of dev config pointing `web-ext` at the Zen binary, and a note about signing.

Why WXT and not the alternatives:

- Plain `web-ext` gives you the dev loop (auto reload on save, temp profile, custom binary) but nothing else. No TypeScript build, no manifest generation, no MV2/MV3 switching, no Firefox sources zip. You would end up wiring Vite or esbuild to it by hand, which is what WXT already is.
- Plasmo lists `firefox-mv3` as "experimental" in its own FAQ. Its last release (v0.90.5) is from May 2025, about 18 months ago, and the WXT comparison page describes it as in maintenance mode. Its dev docs only cover loading into Chrome.
- CRXJS is Chrome-first. Its README does not mention Firefox, and it does either MV2 or MV3, not both.
- WXT runs on `web-ext` under the hood for Firefox, generates the manifest per browser, reloads content scripts and HTML on change, produces the AMO sources zip, and has a `wxt submit` for AMO uploads. Last release 26 Oct 2026.

Trade-off worth knowing: WXT defaults Firefox builds to MV2. You have to pass `--mv3` every time (or set `manifestVersion: 3` in `wxt.config.ts`). MV2 on Firefox is not deprecated the way it is in Chrome, so this is a choice, not a bug, but it is easy to forget.

## Dev loop in Firefox

What the tools do, per their docs:

- `web-ext run` builds, installs temporarily, watches source files and tells Firefox to reload on save. `--no-reload` disables it; `r` reloads manually. `--firefox` takes a path or alias (`firefox`, `beta`, `nightly`, `deved`). `--firefox-profile` copies a named or absolute profile into a fresh temp profile; without `--keep-profile-changes` nothing is saved back. `--pref name=value` sets prefs without touching the profile. `--devtools` (Firefox 106+) and `--start-url` are available. Default `--target` is `firefox-desktop`. Latest release 10.8.0, 15 Oct 2026. Sources: [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/), [getting started with web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/), [web-ext releases](https://github.com/mozilla/web-ext/releases).
- `wxt dev -b firefox` opens Firefox through `web-ext` (install `web-ext` as a dev dependency; since v0.21 it is an optional peer). WXT adds `tabs` and `scripting` permissions in dev mode to drive reloading. Comparison table claims: HMR for UI entrypoints, reload HTML files on change, reload content scripts on change, and only partial reload for the background (all three frameworks share that limit). `Alt+R` / `Option+R` reloads the extension by hand. Sources: [browser startup](https://wxt.dev/guide/essentials/config/browser-startup.html), [manifest config](https://wxt.dev/guide/essentials/config/manifest.html), [compare](https://wxt.dev/guide/resources/compare.html), [upgrading](https://wxt.dev/guide/resources/upgrading.html).
- Custom binary and profile go in `web-ext.config.ts` (git-ignored) or `$HOME/web-ext.config.ts`. `WebExtConfig` exposes `binaries`, `firefoxProfile`, `firefoxArgs`, `firefoxPref`, `keepProfileChanges`, `startUrls`, `openDevtools`, `disabled`. Source: [WebExtConfig](https://wxt.dev/api/reference/wxt/interfaces/WebExtConfig.html).
- Manual fallback: `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on", pick the built `manifest.json`. Gone on restart. Install-time permission prompts are not shown for temporary add-ons. Source: [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

Tooling floor for WXT 0.21: Node 22+, Vite 6.3.4+, TypeScript 5.4+.

## Firefox-specific manifest keys

### `browser_specific_settings.gecko`

- `id` is required to sign an MV3 extension. AMO does not assign one for MV3 (it does for MV2). Format: an email-shaped string or a GUID, 80 chars max. Set it from day one; it also fixes the `moz-extension://` UUID and is required for `storage.sync` (see below). Source: [browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).
- `strict_min_version`: minimum Gecko version. Anything below 115 (ESR) or 128 cannot receive updates due to a root cert expiry.
- `data_collection_permissions` is mandatory for new AMO submissions since 3 November 2025. `required` must be `["none"]` or a list of data types; `optional` is a separate list. For an FPL tool that only reads public pages, `required: ["none"]` is the likely answer, but check what you actually collect.
- Chrome ignores the whole key, so it is safe to put in a shared manifest.

WXT does not generate `gecko.id` for you. Add it under `manifest.browser_specific_settings` in `wxt.config.ts`.

### Background: event page, not service worker

- Firefox does not support `background.service_worker` (bug 1573659). It runs `background.scripts` as a non-persistent event page. Since Firefox 121 it starts the scripts even when `service_worker` is also present, so a shared manifest can list both keys with the same file. Chrome 121+ ignores `scripts`. Source: [background key](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
- `persistent` defaults to `false` in MV3; `true` is an error. Event pages unload "after a few seconds" of idle. Listeners must be registered synchronously at the top level; state goes in `storage.session` or `storage.local`; use `alarms` instead of `setTimeout`. Source: [background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts).
- WXT's `defineBackground()` docs say "for MV3, the background becomes a service worker" and do not say what it emits for Firefox. Verify the generated `.output/firefox-mv3/manifest.json` has `background.scripts` and not only `service_worker`. If it only emits `service_worker`, fix it with a `build:manifestGenerated` hook. This is the one item I could not confirm from the docs and should be checked on first build.

### Host permissions

- In MV3, `host_permissions` are optional and user-revocable. Firefox shows them in the install prompt since 127 but the user can still turn them off. Chrome grants them at install. Check with `permissions.contains`, request with `permissions.request` inside a user gesture (for example `action.onClicked`). Sources: [host_permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions), [permissions.request](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request).
- For a content script on `fantasy.premierleague.com`, that means the script may silently not run until the user grants the host. Build the UI to detect that.

### Other MV3 differences from Chrome

- `browser_action` becomes `action`; Firefox also keeps `page_action`.
- Tabs script injection moves to the `scripting` API (Firefox supports it in MV2 and MV3; Chrome only in MV3).
- CSP for extension pages allows only `'self'` and `'wasm-unsafe-eval'`; remote code is out.
- Source: [MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/).

## Content scripts and storage

### API namespace

`browser.*` with promises is now cross-browser. Chrome added `browser` in 148 and full promise coverage in 152. MDN's Chrome incompatibilities page says the namespace and promises "are no longer a source of incompatibility". Mozilla archived `webextension-polyfill` on 30 Jul 2026 and its README says it will get no further updates. WXT dropped the polyfill from `wxt/browser` in v0.20; its `browser` export is `globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome`, typed from `@types/chrome`. Firefox-only APIs like `sidebarAction` need type augmentation via `@wxt-dev/browser`. Sources: [differences between API implementations](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Differences_between_API_implementations), [Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities), [webextension-polyfill](https://github.com/mozilla/webextension-polyfill), [WXT extension APIs](https://wxt.dev/guide/essentials/extension-apis.html).

One WXT 0.20 gotcha: `browser.runtime.onMessage` listeners no longer return promises as responses. Call `sendResponse` and `return true`.

### Content scripts in Firefox

- Firefox uses Xray vision, not Chrome's isolated world. `globalThis` is a distinct object inheriting from `window`. `eval` runs in the content script; `window.eval` runs in the page. Share objects with the page via `cloneInto()` and `exportFunction()`. Source: [content scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts).
- `world: "MAIN"` exists in the manifest and in `scripting.ExecutionWorld`; the fetched pages do not give the Firefox version it landed in. WXT warns `MAIN` has no extension API access and suggests `injectScript` instead. If you need page-world access, check the compat table before relying on it.
- Content scripts do not run in `about:blank`, `data:` or `blob:` pages unless `match_origin_as_fallback` is set.
- Since Firefox 101, MV3 content-script `fetch` follows the page's CORS policy. Fetching the FPL API from a content script will hit CORS; do it from the background with a host permission instead.
- HTTP(S) requests from content scripts must use absolute URLs.
- WXT: `defineContentScript({ matches, runAt, world, cssInjectionMode, registration, main(ctx) })`. `ctx` tracks invalidation after reload. `createShadowRootUi` isolates styles; `createIframeUi` is the only UI helper with HMR. Source: [WXT content scripts](https://wxt.dev/guide/essentials/content-scripts.html).

### Storage

- Areas: `local`, `sync`, `session`, `managed`. All need the `storage` permission. None are encrypted. Source: [storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage).
- `storage.sync` in Firefox requires `browser_specific_settings.gecko.id` ("you must set an ID for your extension"). Quotas: 100 KB total, 8 KB per item, 512 items. Source: [storage.sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync).
- `storage.local` in Firefox follows IndexedDB limits; request `unlimitedStorage` if you cache a lot of FPL data. Cleared on uninstall. Source: [storage.local](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local).
- `storage.session` is in-memory, 10 MB, cleared on browser exit, not exposed to content scripts unless `setAccessLevel` says so. Source: [storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session).
- WXT ships `@wxt-dev/storage` (1.3.0) via `#imports`: keys are prefixed `local:` / `session:` / `sync:` / `managed:`, `storage.defineItem(key, { fallback, init, version, migrations })`, `watch`, bulk get/set. Migrations run when `defineItem` is called. Source: [WXT storage](https://wxt.dev/storage).
- Do not use `window.localStorage` from extension pages; Firefox clears it with site data.

## Signing and distribution

- Release and Beta Firefox require signed extensions. Developer Edition, Nightly and ESR let you flip `xpinstall.signatures.required`; the extension still needs an id. Source: [signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).
- Unlisted (self-distributed) signing through AMO is the path for a private build. `web-ext sign --channel=unlisted` or `wxt submit` with `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`. Signing can take up to 24 hours.
- AMO requires a source zip when the build is minified or bundled. `wxt zip -b firefox` produces both the extension zip and the sources zip. Check the sources zip by hand once; a `.env` file changes chunk hashes between the two. Source: [WXT publishing](https://wxt.dev/guide/essentials/publishing.html).

## Zen Browser caveats

Zen is a Firefox fork built with Mozilla's `surfer` tooling. It is on rapid release, not ESR: `surfer.json` on `dev` pins Firefox 160.0.1, and the release notes map 1.24.3b (17 Nov 2026) to 160.0.1, 1.24b to 159.0, 1.23b to 157.0 and so on, each a week or two behind the Firefox release. Zen's own docs say extensions install "from the same source: https://addons.mozilla.org". Sources: [surfer.json](https://github.com/zen-browser/desktop/blob/dev/surfer.json), [release notes](https://zen-browser.app/release-notes/), [Zen extensions page](https://docs.zen-browser.app/user-manual/extensions).

Conclusion: no WebExtension API differences found. Zen does not document any, its `docs/` folder has nothing on extensions, and the issue tracker shows regressions, not intentional divergence. What follows are the things that do differ or that you should know.

1. **Point web-ext at the Zen binary.** On macOS the executable is `/Applications/Zen.app/Contents/MacOS/zen` (verified on a local 1.24.1b install). Profiles live in `~/Library/Application Support/zen/Profiles/` (verified locally; the Zen FAQ gives `~/.zen/` on Linux and `%APPDATA%/zen/Profiles` on Windows). In `web-ext.config.ts`:

   ```ts
   import { defineWebExtConfig } from 'wxt';
   export default defineWebExtConfig({
     binaries: { firefox: '/Applications/Zen.app/Contents/MacOS/zen' },
   });
   ```

   Keep this in the git-ignored per-machine file, or `$HOME/web-ext.config.ts`, so CI and other machines fall back to Firefox.

2. **Signing is not compiled in.** Zen's `configs/common/mozconfig` sets `MOZ_REQUIRE_SIGNING=` (empty) with the comment "Allow loading unsigned extensions", and adds `--with-unsigned-addon-scopes=app,system`. The shipped default pref is still `xpinstall.signatures.required = true` (read from the installed `omni.ja`), so behaviour matches release Firefox out of the box, but unlike release Firefox a user can flip it in `about:config`. Useful for installing an unsigned local build permanently; not something to rely on for distribution. Source: [mozconfig](https://github.com/zen-browser/desktop/blob/dev/configs/common/mozconfig).

3. **Firefox themes are not supported**; Zen "mods" are CSS-only UI tweaks from Zen's own registry and have nothing to do with WebExtensions. Irrelevant to this project unless you planned a theme.

4. **Known extension regressions in Zen's tracker** (none affect a content-script-plus-storage extension, but they show Zen can break extension plumbing between point releases):
   - #16125 (open, Oct 2026): sideloaded XPIs in the profile `extensions/` folder register but their background pages never start on Windows.
   - #15058 / #15123 (closed Aug and Sep 2026), #15432 (open): `runtime.connectNative()` regressions. Only matters if you add native messaging.
   - #12198 (closed Feb 2026): Zen did not identify itself in the extensions API. Do not branch on the browser name; use feature detection.
   - #14201 (open): a Bitwarden fetch failure on fresh installs that works in Firefox. Worth remembering if the FPL API fetch misbehaves only in Zen.
   - Source: [issue search](https://github.com/zen-browser/desktop/issues?q=extension+about%3Adebugging).

5. **UI surface differences.** Zen has its own sidebar, compact mode, split view, workspaces and "Glance". None are exposed as extension APIs, and Zen does not document how `sidebar_action` interacts with its sidebar (the `guides/sidebar` doc page 404s). If the extension ever wants a sidebar panel, test it in Zen early. A popup and content-script UI are safer.

6. **Lag behind Firefox.** Expect any new WebExtension API in Firefox N to reach Zen one to two weeks later. Set `strict_min_version` to what Zen stable ships, not to Firefox Nightly.

Not verified: whether `about:debugging` temporary loading has any Zen-specific quirks (only one closed crash issue, #9461, touches it), and the Zen `.dmg` asset naming. `web-ext run` against the Zen binary has not been exercised in this research; it is the first thing to try.

## Suggested setup

```sh
pnpm dlx wxt@latest init haul-extension
cd haul-extension && pnpm add -D web-ext
```

`wxt.config.ts`:

```ts
import { defineConfig } from 'wxt';
export default defineConfig({
  manifestVersion: 3,
  manifest: {
    permissions: ['storage'],
    host_permissions: ['https://fantasy.premierleague.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'haul@<your-domain>',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
```

Then `pnpm wxt dev -b firefox --mv3`, and check `.output/firefox-mv3-dev/manifest.json` for `background.scripts` before writing any background code.

## Open questions for later tickets

- Does WXT emit `background.scripts` for `-b firefox --mv3`, or only `service_worker`? One build answers this.
- Does `sidebar_action` render inside Zen's sidebar? Only matters if the UI plan needs a sidebar.
- `world: "MAIN"` minimum Firefox version, if page-world access is ever needed.

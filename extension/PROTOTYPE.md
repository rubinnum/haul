# PROTOTYPE: stub injection on the transfers page

Throwaway. Answers [issue 9](https://github.com/rubinnum/haul/issues/9): do the three blocks (fixture run, recent points, expected panel) feel useful around each squad card, and does injection survive client-side navigation, view-dropdown changes and squad edits. Fake values only.

## Run it

```sh
cd extension && npm install && npm run build
```

Then in Zen (or Firefox): open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick `extension/.output/firefox-mv3/manifest.json`. Go to https://fantasy.premierleague.com/en/transfers while logged in. If nothing appears, Firefox MV3 treats host access as optional: open `about:addons`, the extension, the **Permissions** tab, and allow `fantasy.premierleague.com`. After a rebuild, press **Reload** on the about:debugging card.

Alternative: `npm run dev` launches Zen through web-ext with a copy of the "Default (release)" profile (see `web-ext.config.ts`) and reloads on save. The copy carries the FPL login; nothing is written back.

## What to look at

A black pill at the bottom of the page switches variants (`◀ ▶` or arrow keys), cycles how home/away shows in the fixture run, cycles how Player Selection rows are treated (`rows`: extra line under each row, compact line under the name with hover detail, or off so you can judge the pitch alone), shows live counters, and dumps the page DOM.

| Key | Variant |
|---|---|
| A | Everything stacked under the card: fixture run, then recent points and expected panel side by side |
| B | Recent points as a column on the left of the shirt, expected panel on the right, fixture run below |
| C | Mirror of B: expected panel left, recent points right |
| D | One compact strip (five FDR squares, points digits, xP); hover the card for the full three blocks |

The variant is also in the URL as `?haul=A&haulfx=ha&haulrows=row` and survives in-page navigation via sessionStorage.

Counters: `pitch` (squad cards found via `button[data-pitch-element]`), `rows` (Player Selection rows found via the info button), `inj` (total injections), `re-inj` (times React wiped our nodes from a card we had already marked), `runs` (observer passes).

Verified offline against a logged-in DOM dump of `/en/transfers` (2026-11-21): 15 pitch cards, 30 rows, keepers detected from the `shirt_<team>_1` kit image.

## What to collect

1. Which variant, or which mix of sides, you want. Whether home/away belongs in the fixture run.
2. One **dump DOM** on the transfers pitch view, one on the transfers list view, one on pick team (`/en/my-team`). Drop the files in the issue or the chat.
3. Anything that breaks: blocks missing after a transfer, after switching the view dropdown, after navigating pick team → transfers, overlaps with neighbouring cards in B/C.

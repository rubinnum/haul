import { defineWebExtConfig } from 'wxt';

// Dev runner config for `npm run dev`. Points web-ext at Zen and copies a
// logged-in Zen profile into the temp profile so the FPL session carries over.
// Edit firefoxProfile if Zen uses the other profile on this machine.
export default defineWebExtConfig({
  binaries: { firefox: '/Applications/Zen.app/Contents/MacOS/zen' },
  firefoxProfile: `${process.env.HOME}/Library/Application Support/zen/Profiles/2vh2pf00.Default (release)`,
  startUrls: ['https://fantasy.premierleague.com/en/transfers'],
});

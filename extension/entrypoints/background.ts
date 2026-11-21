// PROTOTYPE. Exists only so the first Firefox MV3 build answers the open item
// from issue #5: does WXT emit `background.scripts` for Firefox, or only
// `service_worker`? Check .output/firefox-mv3/manifest.json after `npm run build`.
export default defineBackground(() => {
  console.log('[haul-proto] background event page started');
});

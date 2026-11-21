import { defineConfig } from 'wxt';

// PROTOTYPE config. Mirrors the toolchain decision in issue #5; nothing here is final.
export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'haul (prototype: transfers injection)',
    permissions: [],
    host_permissions: ['https://fantasy.premierleague.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'haul-prototype@rubinnum.github.io',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});

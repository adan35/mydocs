import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android and iOS apps: the same web build (`dist/`) inside a native shell.
 * Run `npm run build && npx cap sync` after changing the web app.
 */
const config: CapacitorConfig = {
  appId: 'com.doerwise.mydoc',
  appName: 'My Doc',
  webDir: 'dist',
  backgroundColor: '#ffffff',
  android: {
    // Documents are local; nothing should ever load over plain http.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sayc.app',
  appName: 'sayc2',
  webDir: 'www',
  server: {
    // For test builds: lets the app reach a server on the local network by http.
    // Remove once the API is hosted on https.
    cleartext: true,
  },
  android: {
    // Same purpose as cleartext: the app itself loads from https://localhost.
    allowMixedContent: true,
  },
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.omnitransfer.app',
  appName: 'OmniTransfer',
  webDir: '../desktop/dist',
  backgroundColor: '#0d0f14',
  android: {
    buildOptions: {
      keystorePath: null,
      keystoreAlias: null,
    },
  },
  ios: {
    // Enable local network discovery (required for NWBrowser / Bonjour)
    // Also add NSLocalNetworkUsageDescription to Info.plist
    scheme: 'OmniTransfer',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0d0f14',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    OmniTransfer: {
      // Plugin-level config exposed to OmniTransferPlugin
      serviceUuid: '0000FE55-0000-1000-8000-00805F9B34FB',
      scanDurationMs: 10000,
    },
  },
  server: {
    // Allow cleartext for local Wi-Fi direct transfers
    cleartext: true,
    androidScheme: 'https',
  },
};

export default config;

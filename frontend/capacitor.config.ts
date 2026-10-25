import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.animeuta.mobile',
  appName: 'AnimeUta',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#111116' },
  ios: { backgroundColor: '#111116', contentInset: 'automatic' },
  plugins: {
    Keyboard: {
      resizeOnFullScreen: true,
      autoBackdropColor: 'dom',
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
  },
}

export default config

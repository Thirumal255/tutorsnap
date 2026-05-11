import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tutorsnap.app',
  appName: 'StudyBlox',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '322472504855-1fsal4q80mm9dgijvutqdrnboprjkr27.apps.googleusercontent.com',
    },
  },
};

export default config;

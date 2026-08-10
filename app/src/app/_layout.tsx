import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { bootstrap } from '@/bootstrap';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { FontAssets } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  // Rubik now sets every role, not just the display ones, so a slow load degrades the
  // whole screen to the platform face rather than blanking it, render either way, and
  // let the splash overlay cover the swap.
  const [fontsLoaded] = useFonts(FontAssets);

  // Seeds the local catalog from the bundled copy on first launch, then refreshes in
  // the background. Without this the scan screen's browse is empty on a fresh install
  // and confirming a guess fails.
  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}

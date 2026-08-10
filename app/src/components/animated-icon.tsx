import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors, Motion } from '@/constants/theme';

/**
 * The launch overlay hands off from the native splash screen, so its ground has to
 * match `expo-splash-screen`'s `backgroundColor` in app.json exactly or the app opens
 * with a visible flash of the wrong color.
 *
 * The mark is the backstamp itself: the ring pressed into the underside of a piece,
 * which is what the app is named after and what the scan flow actually reads. It
 * carries no lettering, so a rename stays a change to `shared/branding.ts` alone.
 */
const DURATION = 520;

export function AnimatedSplashOverlay() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[scheme];
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }] },
    45: { opacity: 1, transform: [{ scale: 1 }] },
    100: {
      opacity: 0,
      transform: [{ scale: 1.06 }],
      easing: Easing.bezier(...Motion.easing),
    },
  });

  const mark = (
    <Image
      style={styles.mark}
      contentFit="contain"
      source={require('@/assets/images/splash-icon.png')}
      accessibilityLabel="Backstamp"
    />
  );

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={[styles.splashOverlay, { backgroundColor: colors.background }]}>
      {mark}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={[styles.splashOverlay, { backgroundColor: colors.background }]}>
      {mark}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 112, height: 112 },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});

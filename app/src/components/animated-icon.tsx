import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useRef, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Motion, SplashGround } from '@/constants/theme';

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
// The user reported the splash disappeared too fast to register.
const HOLD = 900;

export function AnimatedSplashOverlay() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const ground = SplashGround[scheme];
  const [visible, setVisible] = useState(true);
  const laidOut = useRef(false);
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ scale: reducedMotion ? 1 : 1 + progress.value * 0.06 }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      onLayout={() => {
        if (laidOut.current) return;
        laidOut.current = true;
        SplashScreen.hideAsync().finally(() => {
          setTimeout(() => {
            progress.value = withTiming(
              1,
              reducedMotion
                ? { duration: Motion.press, reduceMotion: ReduceMotion.Never }
                : { duration: DURATION, easing: Easing.bezier(...Motion.easing) },
              (finished) => {
                'worklet';
                if (finished) {
                  scheduleOnRN(setVisible, false);
                }
              },
            );
          }, HOLD);
        });
      }}
      style={[styles.splashOverlay, { backgroundColor: ground }, animatedStyle]}>
      <Image
        style={styles.mark}
        contentFit="contain"
        source={require('@/assets/images/splash-icon.png')}
        accessibilityLabel="Backstamp"
      />
    </Animated.View>
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

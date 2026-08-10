import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

/**
 * Three glyphs drawn from primitives rather than from the system symbol set.
 *
 * The previous version split iOS onto SF Symbols and Android onto bundled PNGs. The
 * Harvest File direction draws its own marks - a viewfinder that is a rounded square
 * with a lens, a shelf that is four dishes seen from above, a set-up that is three
 * rules - and none of the three exists as a symbol, so one bundled set now serves both
 * platforms. `renderingMode: 'template'` means the tab bar still tints them, so the
 * icons carry no color of their own.
 *
 * Circles in a grid for the shelf is deliberate: a shelf of Pyrex seen from above is
 * exactly that, and it distinguishes the tab from every square-grid icon in the OS.
 */
const ICONS = {
  scan: require('@/assets/images/tabIcons/scan.png'),
  collection: require('@/assets/images/tabIcons/collection.png'),
  settings: require('@/assets/images/tabIcons/settings.png'),
} as const;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const labelStyle = { fontFamily: Fonts.displayLight, fontSize: 10, color: colors.textTertiary };

  return (
    <NativeTabs
      backgroundColor={colors.surface}
      indicatorColor={colors.backgroundElement}
      iconColor={{ default: colors.textTertiary, selected: colors.accent }}
      labelStyle={{ ...labelStyle, selected: { ...labelStyle, color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={ICONS.scan} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="collection">
        <NativeTabs.Trigger.Label>Shelf</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={ICONS.collection} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Set up</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={ICONS.settings} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

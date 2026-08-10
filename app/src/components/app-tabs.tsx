import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

/**
 * iOS gets SF Symbols, which are the system's own glyphs: they inherit weight, they
 * track Dynamic Type, and they ship no bytes. Android has no equivalent lookup under
 * Expo Go — `drawable` needs a resource compiled into the binary — so it gets the
 * hand-drawn set in `assets/images/tabIcons`, rendered as templates so the tab bar
 * still tints them.
 *
 * Circles in a grid for Collection is deliberate: a shelf of Pyrex seen from above is
 * exactly that, and it distinguishes the tab from every square-grid icon in the OS.
 */
const ICONS = {
  scan: { sf: 'camera.viewfinder', src: require('@/assets/images/tabIcons/scan.png') },
  collection: { sf: 'circle.grid.2x2', src: require('@/assets/images/tabIcons/collection.png') },
  settings: { sf: 'slider.horizontal.3', src: require('@/assets/images/tabIcons/settings.png') },
} as const;

function iconProps(name: keyof typeof ICONS) {
  return Platform.OS === 'ios'
    ? ({ sf: ICONS[name].sf } as const)
    : ({ src: ICONS[name].src, renderingMode: 'template' } as const);
}

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.surface}
      indicatorColor={colors.backgroundElement}
      iconColor={{ default: colors.textTertiary, selected: colors.accent }}
      labelStyle={{ color: colors.textTertiary, selected: { color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...iconProps('scan')} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="collection">
        <NativeTabs.Trigger.Label>Collection</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...iconProps('collection')} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...iconProps('settings')} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

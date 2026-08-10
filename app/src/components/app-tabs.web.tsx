import {
  TabList,
  Tabs,
  TabSlot,
  TabTrigger,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import {
  Colors,
  HitTarget,
  MaxContentWidth,
  Radius,
  Rule,
  Spacing,
  Type,
} from '@/constants/theme';
import { BRAND } from '@shared/branding';

// Web counterpart to app-tabs.tsx. The native file uses NativeTabs, which has no web
// implementation, so the two have to be kept in step by hand — same three routes.
//
// It reads as a masthead rather than a floating pill: wordmark left, tabs right, one
// hairline rule underneath. The archive reference puts navigation in a thin band at
// the top of the page and lets the content below carry every bit of the color.

/** Masthead height plus its rule, so screens can be pushed clear of it. */
const WEB_TAB_BAR_HEIGHT = 60;

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%', paddingTop: WEB_TAB_BAR_HEIGHT }} />
      <TabList asChild>
        <Masthead>
          <TabTrigger name="scan" href="/" asChild>
            <TabButton>Scan</TabButton>
          </TabTrigger>
          <TabTrigger name="collection" href="/collection" asChild>
            <TabButton>Collection</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton>Settings</TabButton>
          </TabTrigger>
        </Masthead>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [
        styles.tabButton,
        { borderBottomColor: isFocused ? colors.accent : 'transparent' },
        pressed && { backgroundColor: colors.backgroundElement },
      ]}>
      <Text style={[styles.tabLabel, { color: isFocused ? colors.text : colors.textSecondary }]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function Masthead(props: TabListProps) {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <View
      {...props}
      style={[styles.band, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.inner}>
        <Text style={[styles.wordmark, { color: colors.text }]}>{BRAND.name}</Text>
        <View style={styles.tabs}>{props.children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    width: '100%',
    height: WEB_TAB_BAR_HEIGHT,
    borderBottomWidth: Rule,
    alignItems: 'center',
    flexDirection: 'row',
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    marginHorizontal: 'auto',
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  wordmark: {
    ...Type.label,
    fontSize: 16,
    letterSpacing: 2.4,
    marginRight: 'auto',
  },
  tabs: { flexDirection: 'row', alignItems: 'stretch', height: '100%' },
  tabButton: {
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: Spacing.half,
    borderTopLeftRadius: Radius.xs,
    borderTopRightRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { ...Type.label },
});

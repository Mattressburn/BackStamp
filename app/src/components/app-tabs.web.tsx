import {
  TabList,
  Tabs,
  TabSlot,
  TabTrigger,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { BottomTabInset, Colors, MaxContentWidth, Radius, Spacing, Type } from '@/constants/theme';

// Web counterpart to app-tabs.tsx. The native file uses NativeTabs, which has no web
// implementation, so the two have to be kept in step by hand, same three routes, same
// three glyphs, same labels.
//
// The glyphs are drawn from Views here rather than loaded from the bundled PNGs, since
// a browser can draw a rounded square and four circles for nothing and the result
// stays crisp at any zoom. The shapes and sizes match the PNGs exactly, so a screenshot
// taken here is evidence about the tab bar the phone will draw.

const ICON = 26;

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="scan" href="/" asChild>
            <TabButton glyph="scan">Scan</TabButton>
          </TabTrigger>
          <TabTrigger name="collection" href="/collection" asChild>
            <TabButton glyph="shelf">Shelf</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton glyph="setup">Set up</TabButton>
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

function Glyph({ kind, color }: { kind: 'scan' | 'shelf' | 'setup'; color: string }) {
  if (kind === 'scan') {
    return (
      <View style={[styles.scanFrame, { borderColor: color }]}>
        <View style={[styles.scanLens, { backgroundColor: color }]} />
      </View>
    );
  }

  if (kind === 'shelf') {
    return (
      <View style={styles.shelfGrid}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={[styles.shelfDish, { backgroundColor: color }]} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.setupStack}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.setupRule, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

export function TabButton({
  children,
  isFocused,
  glyph,
  ...props
}: TabTriggerSlotProps & { glyph: 'scan' | 'shelf' | 'setup' }) {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const color = isFocused ? colors.accent : colors.textTertiary;

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      style={styles.tabButton}>
      <Glyph kind={glyph} color={color} />
      <Text style={[styles.tabLabel, { color }]}>{children}</Text>
    </Pressable>
  );
}

export function TabBar(props: TabListProps) {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <View
      {...props}
      style={[
        styles.band,
        { backgroundColor: colors.surface, borderTopColor: colors.backgroundElement },
      ]}>
      <View style={styles.inner}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: BottomTabInset,
    borderTopWidth: 2,
    alignItems: 'center',
    flexDirection: 'row',
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    marginHorizontal: 'auto',
    flexDirection: 'row',
    alignItems: 'flex-start',
    height: '100%',
    paddingTop: Spacing.three - Spacing.one,
  },
  tabButton: { flex: 1, alignItems: 'center', gap: Spacing.two - Spacing.half },
  tabLabel: { ...Type.micro, letterSpacing: 0.6, textTransform: 'none' },

  scanFrame: {
    width: ICON,
    height: ICON,
    borderRadius: Radius.xs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanLens: { width: 11, height: 11, borderRadius: Radius.pill },

  shelfGrid: {
    width: ICON,
    height: ICON,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  shelfDish: { width: 11, height: 11, borderRadius: Radius.pill },

  setupStack: { width: ICON, height: ICON, justifyContent: 'center', gap: 5 },
  setupRule: { height: 2 },
});

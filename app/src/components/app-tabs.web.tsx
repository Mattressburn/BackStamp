import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps, TabListProps } from 'expo-router/ui';
import { Pressable, View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { BRAND } from '@shared/branding';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';

// Web counterpart to app-tabs.tsx. The native file uses NativeTabs, which has no web
// implementation, so the two have to be kept in step by hand — same three routes.

/** Pill height plus its surrounding padding. */
const WEB_TAB_BAR_HEIGHT = 68;
export default function AppTabs() {
  return (
    <Tabs>
      {/* The web tab bar floats at the top rather than sitting at the bottom as it
          does on device, so screens need to be pushed clear of it. Native reads its
          equivalent from BottomTabInset and safe-area insets, which are 0 on web. */}
      <TabSlot style={{ height: '100%', paddingTop: WEB_TAB_BAR_HEIGHT }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="scan" href="/" asChild>
            <TabButton>Scan</TabButton>
          </TabTrigger>
          <TabTrigger name="collection" href="/collection" asChild>
            <TabButton>Collection</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton>Settings</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <ThemedText type="smallBold" style={styles.brandText}>
          {BRAND.name}
        </ThemedText>
        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
});

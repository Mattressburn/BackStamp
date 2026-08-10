import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { API_URL } from '@/api';
import { Colors, Radius, RarityColors, Spacing, Type } from '@/constants/theme';
import type { Photo, PriceSourceKind, Rarity } from '@shared/types';

export function photoSource(photo: Photo, token: string | null) {
  const uri = photo.url.startsWith('http')
    ? photo.url
    : `${API_URL.replace(/\/$/, '')}/${photo.url.replace(/^\//, '')}`;
  return {
    uri,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
}

export function priceSourceLabel(source: PriceSourceKind): string {
  return source === 'sold' ? 'sold, last 90 days' : 'currently listed';
}

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const color = RarityColors[scheme][rarity];

  return (
    <View style={[styles.rarityBadge, { borderColor: color }]}>
      <Text style={[styles.rarityText, { color }]}>{rarity.replaceAll('-', ' ')}</Text>
    </View>
  );
}

export function AiApproximationBadge() {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.aiBadge, { backgroundColor: colors.scrim }]}>
      <Text style={[styles.aiText, { color: Colors.light.accentText }]}>AI approximation</Text>
    </View>
  );
}

export function PhotoPlaceholder({ label = 'No photo yet' }: { label?: string }) {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.placeholder, { backgroundColor: colors.backgroundElement }]}>
      <Text style={[styles.placeholderMark, { color: colors.textTertiary }]}>◇</Text>
      <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rarityBadge: {
    alignSelf: 'flex-start',
    borderWidth: Spacing.half,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  rarityText: {
    ...Type.micro,
    textTransform: 'uppercase',
  },
  aiBadge: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  aiText: {
    ...Type.micro,
    textAlign: 'center',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  placeholderMark: {
    ...Type.title,
  },
  placeholderText: {
    ...Type.caption,
    textAlign: 'center',
  },
});

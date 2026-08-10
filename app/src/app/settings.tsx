import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchCatalog,
  getToken,
  pullCollection,
  pushCollection,
  signIn,
  signOut,
} from '@/api';
import {
  BottomTabInset,
  HitTarget,
  MaxContentWidth,
  Motion,
  Radius,
  Rule,
  Spacing,
  Type,
} from '@/constants/theme';
import {
  getCatalogVersion,
  getCollection,
  getSettings,
  saveSettings,
  replaceCollection,
  syncCatalog,
  type Settings,
} from '@/db';
import { Divider, Label, useColors, useScheme } from '@/features/collection/collection-ui';
import { BRAND } from '@shared/branding';
import type { AuthProvider, PhotoVisibility, UserItem } from '@shared/types';

WebBrowser.maybeCompleteAuthSession();

const VISIBILITIES: PhotoVisibility[] = ['attributed', 'anonymous', 'private'];

async function pushLocalCollection(items: readonly UserItem[]): Promise<number> {
  // CONTRACT: add a shared sync payload type and let pushCollection accept it.
  // Runtime serialization intentionally contains only itemSlug, status, and quantity.
  const payload = items.map(({ itemSlug, status, quantity }) => (
    { itemSlug, status, quantity } as UserItem
  ));
  const pushed = await pushCollection(payload);
  if (!pushed.ok) throw new Error(pushed.error);
  return pushed.data.length;
}

// CONTRACT: app.json must enable Sign in with Apple and declare Google OAuth client IDs.
export default function SettingsScreen() {
  const scheme = useScheme();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const googleClientId = Platform.select({
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    default: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    void Promise.all([getSettings(), getCatalogVersion(), getToken()])
      .then(([storedSettings, version, token]) => {
        setSettings(storedSettings);
        setCatalogVersion(version);
        setSignedIn(Boolean(token));
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
      });
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const syncAfterSignIn = useCallback(async () => {
    const local = await getCollection();
    const pulled = await pullCollection();
    if (!pulled.ok) throw new Error(pulled.error);

    if (pulled.data.length === 0 && local.length > 0) {
      // ponytail: an empty remote is treated as a new account; add sync baselines and
      // deletion tombstones if conflicting offline edits across devices become common.
      return pushLocalCollection(local);
    }

    const localBySlug = new Map(local.map((item) => [item.itemSlug, item]));
    await replaceCollection(pulled.data.map((item) => ({
      ...item,
      condition: localBySlug.get(item.itemSlug)?.condition ?? null,
      notes: localBySlug.get(item.itemSlug)?.notes ?? null,
    })));
    return pulled.data.length;
  }, []);

  const handleIdentity = useCallback(async (provider: AuthProvider, identityToken: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    let authenticated = false;
    try {
      const result = await signIn(provider, identityToken);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      authenticated = true;
      setSignedIn(true);
      const count = await syncAfterSignIn();
      setMessage(`Signed in and synced ${count} ${count === 1 ? 'piece' : 'pieces'}.`);
    } catch (syncError) {
      if (authenticated) {
        setMessage('Signed in. Collection sync will retry when a connection is available.');
      }
      setError(syncError instanceof Error ? syncError.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }, [syncAfterSignIn]);

  async function handleAppleSignIn() {
    if (busy) return;
    try {
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      if (!credential.identityToken) throw new Error('Apple did not return an identity token.');
      await handleIdentity('apple', credential.identityToken);
    } catch (appleError) {
      if (appleError instanceof Error && 'code' in appleError && appleError.code === 'ERR_REQUEST_CANCELED') return;
      setError(appleError instanceof Error ? appleError.message : 'Apple sign-in failed.');
    }
  }

  async function handleCollectionSync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const count = await pushLocalCollection(await getCollection());
      setMessage(`Synced ${count} ${count === 1 ? 'piece' : 'pieces'}.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Collection sync failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setSignedIn(false);
      setMessage('Signed out. Your local collection stays on this device.');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  }

  async function updateSettings(patch: Partial<Settings>) {
    setError(null);
    try {
      setSettings(await saveSettings(patch));
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Could not save settings.');
    }
  }

  async function handleCatalogSync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await fetchCatalog();
    if (result.ok) {
      try {
        await syncCatalog(result.data);
        setCatalogVersion(result.data.version);
        setMessage(`Catalog updated to version ${result.data.version}.`);
      } catch (syncError) {
        setError(syncError instanceof Error ? syncError.message : 'Could not store the catalog.');
      }
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

  async function handleExport() {
    setError(null);
    try {
      const collection = await getCollection();
      await Share.share({
        title: 'Export collection',
        message: JSON.stringify(collection, null, 2),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Could not export collection.');
    }
  }

  const handleGoogleIdentity = useCallback((identityToken: string) => {
    void handleIdentity('google', identityToken);
  }, [handleIdentity]);

  if (!settings) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <ActivityIndicator
            color={colors.accent}
            accessibilityLabel="Loading settings"
            accessibilityRole="progressbar"
          />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.four,
          paddingBottom: insets.bottom + BottomTabInset + Spacing.five,
        },
      ]}>
      {/* The one screen the wordmark is allowed to sit on. Name comes from branding. */}
      <View style={styles.masthead}>
        <Label tone="tertiary">Settings</Label>
        <Text style={[styles.wordmark, { color: colors.text }]}>{BRAND.name}</Text>
        <Label tone="accent">Private by default</Label>
      </View>

      <Section title="Account and sync">
        <View style={styles.metaRow}>
          <Label tone="tertiary">Status</Label>
          <Text style={[styles.state, { color: signedIn ? colors.have : colors.textSecondary }]}>
            {signedIn ? 'Signed in' : 'Not signed in'}
          </Text>
        </View>

        <Fact term="Stored">
          The provider’s subject ID and nothing else — no email, no name, no profile.
        </Fact>
        <Fact term="Synced">
          Your collection syncs as item slugs, have/want status, and counts only.
        </Fact>

        {!signedIn && googleClientId && (
          <GoogleSignInButton
            clientId={googleClientId}
            disabled={busy}
            onIdentityToken={handleGoogleIdentity}
            onError={setError}
          />
        )}
        {!signedIn && !googleClientId && (
          <Fact term="Google">Not configured in this build, so Google sign-in is unavailable here.</Fact>
        )}

        {!signedIn && appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={scheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={Radius.sm}
            onPress={() => void handleAppleSignIn()}
            accessibilityLabel="Sign in with Apple"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            pointerEvents={busy ? 'none' : 'auto'}
            style={styles.appleButton}
          />
        )}

        {signedIn && (
          <>
            {/* The one solid accent fill and the one pill on this screen. */}
            <ActionButton
              label={busy ? 'Syncing…' : 'Sync collection'}
              onPress={() => void handleCollectionSync()}
              disabled={busy}
              primary
            />
            <Pressable
              onPress={() => void handleSignOut()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.signOut,
                pressed && { backgroundColor: colors.backgroundElement },
              ]}>
              <Text style={[styles.signOutText, { color: busy ? colors.textTertiary : colors.danger }]}>
                Sign out
              </Text>
            </Pressable>
          </>
        )}
      </Section>

      <Section title="Training data">
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.text }]}>Help improve identification</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>
              When on, confirmed scans and photos are kept to improve identification later. Default is off.
            </Text>
          </View>
          <Switch
            value={settings.trainingOptIn}
            onValueChange={(value) => void updateSettings({ trainingOptIn: value })}
            trackColor={{ false: colors.backgroundSelected, true: colors.accent }}
            thumbColor={colors.surface}
            style={styles.switch}
            accessibilityRole="switch"
            accessibilityLabel="Help improve identification"
            accessibilityState={{ checked: settings.trainingOptIn }}
          />
        </View>
      </Section>

      <Section title="Default photo visibility" flush>
        <View accessibilityRole="radiogroup">
          {VISIBILITIES.map((visibility, index) => {
            const selected = settings.defaultPhotoVisibility === visibility;
            return (
              <Fragment key={visibility}>
                {index > 0 && <Divider />}
                <Pressable
                  onPress={() => void updateSettings({ defaultPhotoVisibility: visibility })}
                  accessibilityRole="radio"
                  accessibilityLabel={`Use ${visibility} as default photo visibility`}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.choice,
                    {
                      // A continuous index rail down the group, one entry marked.
                      borderLeftColor: selected ? colors.accent : colors.border,
                      backgroundColor: selected
                        ? colors.backgroundSelected
                        : pressed ? colors.backgroundElement : colors.surface,
                    },
                  ]}>
                  <View style={styles.choiceHead}>
                    <Text
                      style={[styles.choiceTitle, { color: selected ? colors.text : colors.textSecondary }]}>
                      {visibility}
                    </Text>
                    {selected && <Label tone="accent">Selected</Label>}
                  </View>
                  <Text style={[styles.copy, { color: colors.textSecondary }]}>{visibilityCopy(visibility)}</Text>
                </Pressable>
              </Fragment>
            );
          })}
        </View>
      </Section>

      <Section title="Catalog">
        <View style={styles.metaRow}>
          <Label tone="tertiary">Offline catalog version</Label>
          <Text style={[styles.numeral, { color: colors.text }]}>{catalogVersion}</Text>
        </View>
        <ActionButton
          label={busy ? 'Updating…' : 'Update catalog'}
          onPress={() => void handleCatalogSync()}
          disabled={busy}
        />
      </Section>

      <Section title="Export">
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Export your local collection entries, including condition and notes, without an account identifier.
        </Text>
        <ActionButton label="Export collection" onPress={() => void handleExport()} />
      </Section>

      {message && <Notice tone="ok">{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </ScrollView>
  );
}

/**
 * A section is a label over a hairline-ruled band, not a card. The band carries a
 * surface tint as well as the rules, because a hairline alone is close to invisible on
 * the dark ground.
 */
function Section({
  title,
  children,
  flush = false,
}: {
  title: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Label>{title}</Label>
      </View>
      <View
        style={[
          styles.sectionBody,
          { backgroundColor: colors.surface, borderColor: colors.border },
          flush ? null : styles.sectionBodyPadded,
        ]}>
        {children}
      </View>
    </View>
  );
}

/** An index entry: the term in the display face, the claim in readable prose beneath it. */
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.fact}>
      <Label tone="tertiary">{term}</Label>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>{children}</Text>
    </View>
  );
}

function Notice({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderLeftColor: tone === 'error' ? colors.danger : colors.have,
        },
      ]}>
      <Text style={[styles.copy, { color: tone === 'error' ? colors.danger : colors.text }]}>{children}</Text>
    </View>
  );
}

function GoogleSignInButton({
  clientId,
  disabled,
  onIdentityToken,
  onError,
}: {
  clientId: string;
  disabled: boolean;
  onIdentityToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const colors = useColors();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ clientId });
  const blocked = disabled || !request;

  useEffect(() => {
    if (response?.type !== 'success') return;
    const identityToken = response.authentication?.idToken ?? response.params.id_token;
    if (identityToken) onIdentityToken(identityToken);
    else onError('Google did not return an identity token.');
  }, [onError, onIdentityToken, response]);

  return (
    <Pressable
      onPress={() => void promptAsync()}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: blocked }}
      style={({ pressed }) => [
        styles.providerButton,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.backgroundSelected : colors.backgroundElement,
          transform: [{ scale: pressed ? Motion.pressScale : 1 }],
        },
      ]}>
      <Text style={[styles.providerMark, { color: blocked ? colors.textTertiary : colors.accent }]}>G</Text>
      <Text style={[styles.providerText, { color: blocked ? colors.textTertiary : colors.text }]}>
        Continue with Google
      </Text>
    </Pressable>
  );
}

function visibilityCopy(visibility: PhotoVisibility): string {
  if (visibility === 'attributed') return 'Published with your handle shown.';
  if (visibility === 'anonymous') return 'Published without attribution, protecting who owns a valuable piece.';
  return 'Never published, for pieces you do not want anyone to know you own.';
}

/**
 * Ghost by default. `primary` is the pill, and the screen gets exactly one — anything
 * else turns the accent into chrome.
 */
function ActionButton({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const colors = useColors();
  // Ghost rests on `backgroundElement`, not `surface`: the section band is already
  // surface, and a hairline border alone is close to invisible on the dark ground.
  const fill = primary
    ? disabled ? colors.backgroundSelected : colors.accent
    : colors.backgroundElement;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.actionButton,
        primary ? styles.actionPrimary : styles.actionGhost,
        {
          borderColor: disabled ? colors.border : primary ? colors.accent : colors.border,
          backgroundColor: !primary && pressed ? colors.backgroundSelected : fill,
          transform: [{ scale: pressed ? Motion.pressScale : 1 }],
        },
      ]}>
      <Text
        style={[
          styles.actionText,
          { color: disabled ? colors.textTertiary : primary ? colors.accentText : colors.text },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.four,
  },

  masthead: { paddingHorizontal: Spacing.three, gap: Spacing.one },
  wordmark: { ...Type.display },

  section: { gap: Spacing.two },
  sectionHead: { paddingHorizontal: Spacing.three },
  sectionBody: { borderTopWidth: Rule, borderBottomWidth: Rule },
  sectionBodyPadded: { padding: Spacing.three, gap: Spacing.three },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  state: { ...Type.label },
  numeral: { ...Type.numeral },

  fact: { gap: Spacing.one },
  copy: { ...Type.body },

  settingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  settingCopy: { flex: 1, gap: Spacing.one },
  settingTitle: { ...Type.bodyStrong },
  switch: { minWidth: HitTarget, minHeight: HitTarget },

  choice: {
    minHeight: HitTarget,
    borderLeftWidth: Spacing.half,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  choiceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  choiceTitle: { ...Type.label },

  providerButton: {
    minHeight: HitTarget,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  providerMark: { ...Type.numeral },
  providerText: { ...Type.bodyStrong },
  appleButton: { width: '100%', height: HitTarget },

  signOut: { minHeight: HitTarget, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  signOutText: { ...Type.bodyStrong },

  actionButton: {
    minHeight: HitTarget,
    borderWidth: Rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { borderRadius: Radius.pill, paddingHorizontal: Spacing.four },
  actionGhost: { borderRadius: Radius.sm, paddingHorizontal: Spacing.three },
  actionText: { ...Type.bodyStrong },

  notice: {
    alignSelf: 'stretch',
    borderTopWidth: Rule,
    borderBottomWidth: Rule,
    borderLeftWidth: Spacing.half,
    padding: Spacing.three,
  },
});

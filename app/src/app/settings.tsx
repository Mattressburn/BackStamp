import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
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
  Colors,
  Elevation,
  HitTarget,
  MaxContentWidth,
  Radius,
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
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[scheme];
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
          <Text style={[styles.notice, { color: colors.danger, borderColor: colors.border }]}>{error}</Text>
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
          paddingTop: insets.top + Spacing.three,
          paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
        },
      ]}>
      <View>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>PRIVATE BY DEFAULT</Text>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
      </View>

      <SettingsSection title="Account and sync" colors={colors}>
        <Text style={[styles.status, { color: signedIn ? colors.have : colors.textSecondary }]}>
          {signedIn ? 'Signed in' : 'Not signed in'}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We store the provider’s subject ID and nothing else—no email, name, or profile. Your collection syncs as item slugs, have/want status, and counts only.
        </Text>

        {!signedIn && googleClientId && (
          <GoogleSignInButton
            clientId={googleClientId}
            colors={colors}
            disabled={busy}
            onIdentityToken={handleGoogleIdentity}
            onError={setError}
          />
        )}
        {!signedIn && !googleClientId && (
          <DisabledProviderButton label="Continue with Google" colors={colors} />
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
            <ActionButton
              label={busy ? 'Syncing…' : 'Sync collection'}
              onPress={() => void handleCollectionSync()}
              colors={colors}
              disabled={busy}
              secondary
            />
            <Pressable
              onPress={() => void handleSignOut()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [styles.signOut, pressed && { backgroundColor: colors.backgroundElement }]}>
              <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
            </Pressable>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Training data" colors={colors}>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.text }]}>Help improve identification</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
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
      </SettingsSection>

      <SettingsSection title="Default photo visibility" colors={colors}>
        {VISIBILITIES.map((visibility) => {
          const selected = settings.defaultPhotoVisibility === visibility;
          return (
            <Pressable
              key={visibility}
              onPress={() => void updateSettings({ defaultPhotoVisibility: visibility })}
              accessibilityRole="radio"
              accessibilityLabel={`Use ${visibility} as default photo visibility`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.visibilityChoice,
                { borderColor: selected ? colors.accent : colors.border },
                selected && { backgroundColor: colors.backgroundSelected },
                pressed && { backgroundColor: colors.backgroundElement },
              ]}>
              <View style={styles.settingCopy}>
                <Text style={[styles.visibilityTitle, { color: colors.text }]}>{visibility}</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>{visibilityCopy(visibility)}</Text>
              </View>
              <Text style={[styles.radioMark, { color: selected ? colors.accent : colors.textTertiary }]}>
                {selected ? '●' : '○'}
              </Text>
            </Pressable>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Catalog" colors={colors}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>Offline catalog version {catalogVersion}</Text>
        <ActionButton
          label={busy ? 'Updating…' : 'Update catalog'}
          onPress={() => void handleCatalogSync()}
          colors={colors}
          disabled={busy}
        />
      </SettingsSection>

      <SettingsSection title="Export" colors={colors}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Export your local collection entries, including condition and notes, without an account identifier.
        </Text>
        <ActionButton
          label="Export collection"
          onPress={() => void handleExport()}
          colors={colors}
        />
      </SettingsSection>

      {message && <Text style={[styles.notice, { color: colors.have, borderColor: colors.border }]}>{message}</Text>}
      {error && <Text style={[styles.notice, { color: colors.danger, borderColor: colors.border }]}>{error}</Text>}
    </ScrollView>
  );
}

function GoogleSignInButton({
  clientId,
  colors,
  disabled,
  onIdentityToken,
  onError,
}: {
  clientId: string;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
  disabled: boolean;
  onIdentityToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ clientId });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const identityToken = response.authentication?.idToken ?? response.params.id_token;
    if (identityToken) onIdentityToken(identityToken);
    else onError('Google did not return an identity token.');
  }, [onError, onIdentityToken, response]);

  return (
    <Pressable
      onPress={() => void promptAsync()}
      disabled={disabled || !request}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: disabled || !request }}
      style={({ pressed }) => [
        styles.providerButton,
        { borderColor: colors.border, backgroundColor: pressed ? colors.backgroundElement : colors.surface },
      ]}>
      <Text style={[styles.providerMark, { color: colors.accent }]}>G</Text>
      <Text style={[styles.providerText, { color: colors.text }]}>Continue with Google</Text>
    </Pressable>
  );
}

function DisabledProviderButton({
  label,
  colors,
}: {
  label: string;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
  return (
    <View style={[styles.providerButton, { borderColor: colors.border, backgroundColor: colors.backgroundElement }]}>
      <Text style={[styles.providerText, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.unavailable, { color: colors.textTertiary }]}>Not configured</Text>
    </View>
  );
}

function visibilityCopy(visibility: PhotoVisibility): string {
  if (visibility === 'attributed') return 'Published with your handle shown.';
  if (visibility === 'anonymous') return 'Published without attribution, protecting who owns a valuable piece.';
  return 'Never published, for pieces you do not want anyone to know you own.';
}

function SettingsSection({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, ...Elevation.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  colors,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.actionButton,
        {
          borderColor: secondary ? colors.border : colors.accent,
          backgroundColor: secondary
            ? pressed ? colors.backgroundSelected : colors.backgroundElement
            : pressed ? colors.have : colors.accent,
        },
      ]}>
      <Text style={[styles.actionText, { color: secondary ? colors.text : colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  eyebrow: { ...Type.micro, letterSpacing: Spacing.half },
  title: { ...Type.display },
  section: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.three },
  sectionTitle: { ...Type.headline },
  body: { ...Type.body },
  status: { ...Type.bodyStrong },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  settingCopy: { flex: 1, gap: Spacing.one },
  settingTitle: { ...Type.bodyStrong },
  switch: { minWidth: HitTarget, minHeight: HitTarget },
  visibilityChoice: { minHeight: HitTarget, borderWidth: Spacing.half, borderRadius: Radius.md, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  visibilityTitle: { ...Type.bodyStrong, textTransform: 'capitalize' },
  radioMark: { ...Type.headline },
  providerButton: { minHeight: HitTarget, borderWidth: Spacing.half, borderRadius: Radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  providerMark: { ...Type.bodyStrong },
  providerText: { ...Type.bodyStrong },
  unavailable: { ...Type.micro, marginLeft: 'auto' },
  appleButton: { width: '100%', height: HitTarget },
  signOut: { minHeight: HitTarget, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  signOutText: { ...Type.bodyStrong },
  actionButton: { minHeight: HitTarget, borderWidth: Spacing.half, borderRadius: Radius.pill, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...Type.bodyStrong },
  notice: { ...Type.callout, borderWidth: Spacing.half, borderRadius: Radius.md, padding: Spacing.three },
});

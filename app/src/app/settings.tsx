/**
 * Set up, drawn as the card file's own drawer.
 *
 * Read the reference lock in `constants/theme.ts` first. This screen is the plainest
 * expression of it: an avocado header band, then labelled groups, each one a single
 * index card whose rows are divided by the one rule this direction still allows. The
 * card's solid offset does the separating; there is no blur anywhere on this screen.
 *
 * The Harvest File prototype drew three groups (account, prices, catalog). The screen
 * says more than that and none of it was cut to match the mock: what sign-in stores,
 * what sync carries, the four photo-visibility choices, the training opt-in and its
 * default, and the fact that Google sign-in is unconfigured in this build rather than
 * merely broken. Those are claims, not decoration, so they were reskinned into rows
 * instead of deleted.
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Children, Fragment, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type AccessibilityState,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchCatalog, getToken, pullCollection, pushCollection, signIn, signOut } from '@/api';
import {
  BottomTabInset,
  HitTarget,
  MaxContentWidth,
  Motion,
  OnAccent,
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
  countCatalogItems,
  syncCatalog,
  type Settings,
} from '@/db';
import {
  Card,
  Divider,
  HeaderBar,
  Label,
  PressButton,
  useColors,
  useScheme,
} from '@/features/collection/collection-ui';
import { BRAND } from '@shared/branding';
import type { AuthProvider, PhotoVisibility, UserItem } from '@shared/types';

WebBrowser.maybeCompleteAuthSession();

const VISIBILITIES: PhotoVisibility[] = ['attributed', 'anonymous', 'private'];
const CMOG_PATTERN_LIBRARY_URL = 'https://pyrex.cmog.org/pattern-library';

/** The shared curve, as an easing function. Every motion on this screen uses it. */
const EASING = Easing.bezier(...Motion.easing);

/** 46 x 27 track, 21pt knob at left 3 or left 22, so the knob travels 19. */
const TOGGLE = { width: 46, height: 27, knob: 21, inset: 3 } as const;
const KNOB_TRAVEL = TOGGLE.width - TOGGLE.knob - TOGGLE.inset * 2;

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
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
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
    void Promise.all([getSettings(), getCatalogVersion(), getToken(), countCatalogItems()])
      .then(([storedSettings, version, token, count]) => {
        setSettings(storedSettings);
        setCatalogVersion(version);
        setSignedIn(Boolean(token));
        setCatalogCount(count);
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
        setCatalogCount(await countCatalogItems());
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
        title: `${BRAND.name} collection export`,
        message: JSON.stringify(collection, null, 2),
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Could not export collection.');
    }
  }

  const handleGoogleIdentity = useCallback((identityToken: string) => {
    void handleIdentity('google', identityToken);
  }, [handleIdentity]);

  // The header band stays up while settings load: without it the screen reads as broken
  // rather than as busy, since the tab bar is drawn either way.
  if (!settings) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Header />
        <View style={styles.centered}>
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
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Header />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + BottomTabInset + Spacing.five },
        ]}>
        <Group label="Your account">
          <Row
            strong
            lead={
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: signedIn ? colors.want : colors.backgroundElement },
                ]}
              />
            }
            title={signedIn ? 'Signed in' : 'Not signed in'}
            caption={
              signedIn
                ? 'Your collection syncs across devices.'
                : 'Everything stays on this phone until you sign in.'
            }
          />
          <Row
            title="Display name"
            value="Not stored"
            valueTone="spice"
            caption="Sign-in keeps the provider's subject ID and nothing else: no email, no name, no profile."
          />
          <Row
            title="What syncs"
            value="Pieces and counts"
            valueTone="spice"
            caption="Which catalogued pieces you have or want, and how many. Condition and notes never leave this device."
          />
          {!signedIn && !googleClientId && (
            <Row
              title="Google sign-in"
              value="Unavailable"
              valueTone="quiet"
              caption="Not configured in this build, so there is no Google button to press rather than a dead one."
            />
          )}
        </Group>

        <View style={styles.actions}>
          {!signedIn && googleClientId && (
            <GoogleSignInButton
              clientId={googleClientId}
              disabled={busy}
              onIdentityToken={handleGoogleIdentity}
              onError={setError}
            />
          )}

          {!signedIn && appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={scheme === 'dark'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={Radius.lg}
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
              <PressButton
                onPress={() => void handleCollectionSync()}
                disabled={busy}
                accessibilityLabel="Sync collection">
                {busy ? 'Syncing…' : 'Sync collection'}
              </PressButton>
              <PressButton
                tone="quiet"
                onPress={() => void handleSignOut()}
                disabled={busy}
                accessibilityLabel="Sign out"
                textStyle={{ color: busy ? colors.textTertiary : colors.danger }}>
                Sign out
              </PressButton>
            </>
          )}
        </View>

        <Group label="Prices">
          <ToggleRow
            title="Hide values on the shelf"
            checked={settings.hideValuesOnShelf}
            onChange={(value) => void updateSettings({ hideValuesOnShelf: value })}
          />
        </Group>

        <View accessibilityRole="radiogroup">
          <Group label="Default photo visibility" caption="Private by default.">
            {VISIBILITIES.map((visibility) => {
              const selected = settings.defaultPhotoVisibility === visibility;
              return (
                <Row
                  key={visibility}
                  title={visibility.charAt(0).toUpperCase() + visibility.slice(1)}
                  caption={visibilityCopy(visibility)}
                  value={selected ? 'Selected' : undefined}
                  onPress={() => void updateSettings({ defaultPhotoVisibility: visibility })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Use ${visibility} as default photo visibility`}
                />
              );
            })}
          </Group>
        </View>

        <Group label="Training data">
          <ToggleRow
            title="Help improve identification"
            caption="When on, confirmed scans and photos are kept to improve identification later. Default is off."
            checked={settings.trainingOptIn}
            onChange={(value) => void updateSettings({ trainingOptIn: value })}
          />
        </Group>

        <Group label="Catalog">
          <Row
            title={catalogCount === null ? 'Catalog on this phone' : `${catalogCount} items on this phone`}
            caption={`Offline copy, version ${catalogVersion}.`}
            value={busy ? 'Updating…' : 'Refresh'}
            onPress={() => void handleCatalogSync()}
            disabled={busy}
            accessibilityLabel="Refresh the offline catalog"
          />
          <Row
            title="Export my collection"
            caption="Your local entries, condition and notes included, with no account identifier."
            value="JSON"
            valueTone="quiet"
            onPress={() => void handleExport()}
            accessibilityLabel="Export my collection as JSON"
          />
        </Group>

        <Group label="Sources">
          <Row
            title="Corning Museum of Glass"
            caption="Pattern names and production dates from the Pyrex Pattern Library."
            value="Visit"
            onPress={() => void Linking.openURL(CMOG_PATTERN_LIBRARY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open the Corning Museum of Glass Pyrex Pattern Library"
          />
        </Group>

        {message && <Notice tone="ok">{message}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </ScrollView>
    </View>
  );
}

/**
 * The offline catalog's size.
 *
 * Counts in SQLite via `countCatalogItems()` rather than reading the length of a search
 * result, which would load all 379 rows to learn how many there are.
 */

/**
 * The avocado band, plus the status bar above it.
 *
 * CONTRACT: `HeaderBar` in `collection-ui` does not take the top safe-area inset, so
 * every screen that uses it has to paint the status bar itself. It would be one
 * `useSafeAreaInsets()` inside the primitive.
 */
function Header() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
      <HeaderBar title="Set up" />
    </View>
  );
}

/**
 * A spice label over one card. Children are rows, and the rule between them is drawn
 * here rather than at the call site, which is why they must be flat siblings: a
 * fragment wrapping two rows counts as one child and loses the rule between them.
 */
function Group({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const rows = Children.toArray(children);

  return (
    <View style={styles.group}>
      <Label>{label}</Label>
      {caption && <Text style={[styles.groupCaption, { color: colors.textSecondary }]}>{caption}</Text>}
      <Card style={styles.groupCard}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 && <Divider />}
            {row}
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

type ValueTone = 'accent' | 'spice' | 'quiet';

/** One line of a group card: optional lead, a title over its caption, a value or control. */
function Row({
  title,
  caption,
  value,
  valueTone = 'accent',
  lead,
  right,
  strong = false,
  onPress,
  disabled = false,
  accessibilityRole = 'button',
  accessibilityState,
  accessibilityLabel,
}: {
  title: string;
  caption?: string;
  value?: string;
  valueTone?: ValueTone;
  lead?: React.ReactNode;
  right?: React.ReactNode;
  strong?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const valueColor = { accent: colors.accent, spice: colors.spice, quiet: colors.textTertiary }[
    valueTone
  ];

  const body = (
    <>
      {lead}
      <View style={styles.rowCopy}>
        <Text style={[strong ? styles.rowTitleStrong : styles.rowTitle, { color: colors.text }]}>
          {title}
        </Text>
        {caption && (
          <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>{caption}</Text>
        )}
      </View>
      {value !== undefined && (
        <Text style={[styles.rowValue, { color: disabled ? colors.textTertiary : valueColor }]}>
          {value}
        </Text>
      )}
      {right}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? title}
      // An explicit label replaces the child text, which would drop the caption, and on
      // these rows the caption is the substance ("Default is off").
      accessibilityHint={caption}
      accessibilityState={{ ...accessibilityState, disabled }}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && { backgroundColor: colors.backgroundElement },
      ]}>
      {body}
    </Pressable>
  );
}

function ToggleRow({
  title,
  caption,
  checked,
  onChange,
}: {
  title: string;
  caption?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Row
      title={title}
      caption={caption}
      onPress={() => onChange(!checked)}
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      right={<Toggle checked={checked} />}
    />
  );
}

/**
 * The one control this direction draws from scratch: a 46 x 27 pill whose knob slides
 * rather than scales, and whose track crossfades avocado to the quiet fill. The whole
 * row is the tap target, so the pill itself takes no touches.
 */
function Toggle({ checked }: { checked: boolean }) {
  const colors = useColors();
  const reduced = useReducedMotion();

  const progress = useDerivedValue(
    () =>
      reduced
        ? (checked ? 1 : 0)
        : withTiming(checked ? 1 : 0, { duration: Motion.enter, easing: EASING }),
    [checked, reduced],
  );

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.backgroundElement, colors.accent],
    ),
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * KNOB_TRAVEL }] }));

  return (
    <Animated.View style={[styles.track, track]} pointerEvents="none">
      <Animated.View style={[styles.knob, knob]} />
    </Animated.View>
  );
}

/** Feedback from the last action, as a card rather than a banner. */
function Notice({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  const colors = useColors();

  return (
    <View accessibilityLiveRegion="polite">
      <Card style={styles.notice}>
        {/* `Label` has no danger tone, so an error announces itself in spice and says so. */}
        <Label tone={tone === 'error' ? 'spice' : 'accent'}>
          {tone === 'error' ? 'Did not work' : 'Done'}
        </Label>
        <Text style={[styles.rowTitle, { color: tone === 'error' ? colors.danger : colors.text }]}>
          {children}
        </Text>
      </Card>
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
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ clientId });
  const blocked = disabled || !request;

  useEffect(() => {
    if (response?.type !== 'success') return;
    const identityToken = response.authentication?.idToken ?? response.params.id_token;
    if (identityToken) onIdentityToken(identityToken);
    else onError('Google did not return an identity token.');
  }, [onError, onIdentityToken, response]);

  return (
    <PressButton
      tone="quiet"
      onPress={() => void promptAsync()}
      disabled={blocked}
      accessibilityLabel="Continue with Google">
      Continue with Google
    </PressButton>
  );
}

function visibilityCopy(visibility: PhotoVisibility): string {
  if (visibility === 'attributed') return 'Published with your handle shown.';
  if (visibility === 'anonymous') return 'Published without attribution, protecting who owns a valuable piece.';
  return 'Never published, for pieces you do not want anyone to know you own.';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.gutter },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.gutter,
    gap: Spacing.gutter,
  },

  // 10: the gap the mocks put between a label and its card, and between stacked cards.
  group: { gap: Spacing.two + Spacing.half },
  groupCaption: { ...Type.caption },
  groupCard: { borderRadius: Radius.lg },

  // Buttons carry their own offset, and `Card` clips its children, so the auth actions
  // sit below the account card rather than inside it.
  actions: { gap: Spacing.two + Spacing.half },
  appleButton: { width: '100%', height: HitTarget },

  row: {
    minHeight: HitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - Spacing.one,
    padding: Spacing.three - Spacing.half,
  },
  rowCopy: { flex: 1, gap: Spacing.half },
  rowTitle: { ...Type.body },
  rowTitleStrong: { ...Type.bodyStrong },
  rowCaption: { ...Type.caption },
  rowValue: { ...Type.bodyStrong },

  avatar: { width: 42, height: 42, borderRadius: Radius.pill },

  track: {
    width: TOGGLE.width,
    height: TOGGLE.height,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    paddingHorizontal: TOGGLE.inset,
  },
  knob: {
    width: TOGGLE.knob,
    height: TOGGLE.knob,
    borderRadius: Radius.pill,
    backgroundColor: OnAccent.text,
  },

  notice: { padding: Spacing.three - Spacing.half, gap: Spacing.one },
});

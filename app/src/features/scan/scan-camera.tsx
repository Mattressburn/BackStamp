/**
 * The dark half of the scan flow: permission, the two-shot viewfinder, and the wait.
 *
 * Everything here draws from the `CameraChrome` token block rather than from the app
 * palette, because it sits over a live camera feed and a light-mode scan screen would
 * wash the viewfinder out. That is the one block in `theme.ts` that is fixed in both
 * schemes, and this file is the only place it is allowed.
 *
 * The camera preview fills the dashed frame and nothing else. The prototype draws an
 * opaque ground with a bordered window cut into it, which is also the only arrangement
 * where 29px cream titles stay legible: over an arbitrary thrift-aisle scene they would
 * not be.
 *
 * Sizes here are the prototype's, which the handoff declares final. Where a value has a
 * token it reads through the token; the rest are named constants rather than numbers
 * buried in a style, so the next person can see what came from the mock.
 */

import { CameraView } from 'expo-camera';
import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BottomTabInset,
  CameraChrome,
  HitTarget,
  Motion,
  OnAccent,
  Radius,
  Rule,
  Spacing,
  Type,
} from '@/constants/theme';
import { PressButton, useColors, useElevation } from '@/features/collection/collection-ui';

/**
 * CONTRACT: the handoff hides the tab bar for the whole scan flow. It is a native tab
 * bar owned by `components/app-tabs.tsx` and a screen cannot reach it, so until the
 * route hides it every pinned footer in this flow clears it by hand. Drop this to 0 in
 * one place once the tab bar is hidden for the scan route, or these screens gain 78pt
 * of dead space at the bottom.
 */
export const TAB_BAR_CLEARANCE = BottomTabInset;

/** Prototype geometry. The handoff calls these final, so they are literals, not derived. */
const PERMISSION_TILE = 96;
const PERMISSION_TILE_RADIUS = 28;
const PERMISSION_RING = 44;
const RING_STROKE = 5;
const VIEWFINDER_INSET = 26;
const VIEWFINDER_ASPECT = 0.92;
/** No token sits between `Radius.xl` (18) and `Radius.xxl` (26); the mock wants 22. */
const GUIDE_RADIUS = 22;
const GUIDE_STROKE = 3;
const SQUARE_GUIDE_FRACTION = '60%';
const CIRCLE_GUIDE_FRACTION = '62%';
const SHUTTER = 82;
const SIDE_CONTROL = HitTarget + Spacing.one; // 48
const SPIN_RING = 96;
const DOT = 8;
const DOT_GAP = 7;

/** Durations the mock specifies that `Motion` has no token for. */
const RING_SPIN_MS = 900;
const DOT_PULSE_MS = 1000;
const DOT_STAGGER_MS = 200;

/**
 * A guide, not a reading. The mock ghosts "474" inside the circle to show where the
 * mark sits; a real model number there would be indistinguishable from a claim that we
 * had already read one, and we have not, `/identify` has not been called yet.
 */
const GUIDE_GLYPH = '000';

// ------------------------------------------------------------------ shared

/**
 * The one banner the scan flow uses for anything it needs to say: queued scans, a
 * failed sync, a camera error. Spice ground with a gold dot, which is the treatment the
 * handoff gives the offline notice on screen 12.
 *
 * Deliberately duplicated rather than shared with the item-detail screen that draws the
 * same thing: that file belongs to another agent and ten lines is cheaper than a seam.
 */
export function ScanBanner({
  message,
  tone = 'note',
}: {
  message: string | null;
  tone?: 'note' | 'problem';
}) {
  const colors = useColors();
  if (!message) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: tone === 'problem' ? colors.danger : colors.spice },
      ]}>
      <View style={[styles.bannerDot, { backgroundColor: colors.want }]} />
      <Text style={styles.bannerText}>{message}</Text>
    </View>
  );
}

/** Full-screen cream at opacity 1, then out. The shutter's only feedback. */
export function ShutterFlash({ visible }: { visible: boolean }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      opacity.value = 0;
      return;
    }
    // The 150ms hold is the caller's timeout on `visible`; holding again here would
    // double it and make the shutter feel stuck.
    opacity.value = visible ? 1 : withTiming(0, { duration: Motion.enter });
  }, [opacity, reduced, visible]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.flash, animated]} />
  );
}

/** The quiet 48x48 control beside the shutter. Filled only when it does something. */
function SideControl({
  glyph,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  glyph?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  // An empty slot keeps the shutter centred but stays transparent: a filled square that
  // looks tappable and is not is worse than an asymmetric row.
  if (!onPress) return <View style={[styles.sideControl, styles.inert]} />;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sideControl,
        styles.sideControlFilled,
        pressed && { transform: [{ translateY: Motion.pressTranslate }] },
      ]}>
      <Text style={styles.sideControlGlyph}>{glyph}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ 7 · permission

/**
 * Asked before the OS asks, so the system prompt is not the first time anyone explains
 * why a Pyrex app wants a camera. The second action is the whole reason the browse
 * catalog is offline-first: declining here still leaves a usable app.
 */
export function PermissionScreen({
  mode,
  onRequest,
  onBrowse,
}: {
  mode: 'checking' | 'undetermined' | 'denied';
  onRequest: () => void;
  onBrowse: () => void;
}) {
  const insets = useSafeAreaInsets();

  const primary = {
    checking: { label: 'Checking the camera…', disabled: true },
    undetermined: { label: 'Allow the camera', disabled: false },
    denied: { label: 'Open app settings', disabled: false },
  }[mode];

  const blurb =
    mode === 'denied'
      ? 'Camera access is off. Turn it back on in this app’s system settings, or look the piece up by hand.'
      : 'Two photos per piece: the pattern, then the number underneath. Nothing leaves your phone until you shelve it.';

  return (
    <View style={styles.ground}>
      <View style={[styles.permissionBody, { paddingTop: insets.top + Spacing.six + Spacing.four }]}>
        <View style={styles.permissionTile}>
          <View style={styles.permissionRing} />
        </View>
        <Text accessibilityRole="header" style={styles.permissionTitle}>
          We’ll need the camera
        </Text>
        <Text style={styles.permissionBlurb}>{blurb}</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.two }]}>
        <PressButton
          tone="gold"
          disabled={primary.disabled}
          onPress={onRequest}
          accessibilityLabel={primary.label}>
          {primary.label}
        </PressButton>
        <PressButton
          tone="translucent"
          onPress={onBrowse}
          accessibilityLabel="Look it up by hand"
          accessibilityHint="Opens the catalog saved on this phone">
          Look it up by hand
        </PressButton>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 0 / 1 · viewfinder

/**
 * Both shots, one component. Shot one asks for the printed pattern behind a square
 * guide; shot two asks for the mark on the underside behind a circle, because that is
 * the shape of the thing being centred.
 */
export function ViewfinderScreen({
  mode,
  showModeToggle,
  pendingImportCount,
  step,
  banner,
  problem,
  busy,
  cameraRef,
  onCameraReady,
  onMountError,
  onCapture,
  onImport,
  onConfirmImport,
  onCancelImport,
  onBack,
  onSkip,
  onModeChange,
}: {
  mode: 'single' | 'set';
  showModeToggle: boolean;
  pendingImportCount: number;
  step: 1 | 2;
  banner: string | null;
  problem: string | null;
  busy: boolean;
  cameraRef: React.RefObject<CameraView | null>;
  onCameraReady: () => void;
  onMountError: (message: string) => void;
  onCapture: () => void;
  onImport: () => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onBack: () => void;
  onSkip: () => void;
  onModeChange: (mode: 'single' | 'set') => void;
}) {
  const insets = useSafeAreaInsets();
  const elevation = useElevation();
  const second = mode === 'single' && step === 2;
  const setMode = mode === 'set';

  return (
    <View style={styles.ground}>
      <View style={[styles.viewfinderHead, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.headRow}>
          <Text style={styles.headLabel}>
            {setMode ? 'Found a set?' : second ? 'Now flip it over' : 'Found something?'}
          </Text>
          {!setMode && (
            <Text
              accessibilityLabel={`Shot ${step} of 2`}
              style={styles.headCount}>{`${step} / 2`}</Text>
          )}
        </View>
        {showModeToggle && (
          <View style={styles.modeControls}>
            <View accessibilityRole="radiogroup" style={styles.modeToggle}>
              {(['single', 'set'] as const).map((option) => {
                const selected = option === mode;
                const label = option === 'single' ? 'One piece' : 'Whole set';
                return (
                  <Pressable
                    accessibilityLabel={`${label} scan mode`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: pendingImportCount > 0 }}
                    disabled={pendingImportCount > 0}
                    key={option}
                    onPress={() => onModeChange(option)}
                    style={({ pressed }) => [
                      styles.modeOption,
                      selected && styles.modeOptionSelected,
                      pressed && { transform: [{ translateY: Motion.pressTranslate }] },
                    ]}>
                    <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityLabel="Import photos from my library"
              accessibilityRole="button"
              accessibilityState={{ disabled: pendingImportCount > 0 }}
              disabled={pendingImportCount > 0}
              onPress={onImport}
              style={({ pressed }) => [
                styles.importAction,
                pressed && { transform: [{ translateY: Motion.pressTranslate }] },
              ]}>
              <Text style={styles.importActionText}>Import</Text>
            </Pressable>
          </View>
        )}
        <ScanBanner message={banner} />
        <ScanBanner message={problem} tone="problem" />
      </View>

      <View style={styles.frame}>
        <CameraView
          accessible={false}
          facing="back"
          onCameraReady={onCameraReady}
          onMountError={({ message }) => onMountError(message)}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.guideWrap}>
          {second ? (
            <View style={[styles.guide, styles.guideCircle]}>
              <Text style={styles.guideGlyph}>{GUIDE_GLYPH}</Text>
            </View>
          ) : (
            <View style={[styles.guide, styles.guideSquare]} />
          )}
        </View>
      </View>

      <View style={styles.viewfinderCopy}>
        {pendingImportCount > 0 ? (
          <View style={styles.importConfirm}>
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="header"
              style={styles.importConfirmTitle}>
              Identify {pendingImportCount} {pendingImportCount === 1 ? 'photo' : 'photos'}?
            </Text>
            <Text style={styles.importConfirmCopy}>Each one costs a model call.</Text>
            <View style={styles.importConfirmActions}>
              <Pressable
                accessibilityLabel={`Identify ${pendingImportCount} ${pendingImportCount === 1 ? 'photo' : 'photos'}`}
                accessibilityRole="button"
                onPress={onConfirmImport}
                style={({ pressed }) => [
                  styles.importConfirmPrimary,
                  pressed && { transform: [{ translateY: Motion.pressTranslate }] },
                ]}>
                <Text style={styles.importConfirmPrimaryText}>Proceed</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Cancel photo import"
                accessibilityRole="button"
                onPress={onCancelImport}
                style={({ pressed }) => [
                  styles.importConfirmSecondary,
                  pressed && { transform: [{ translateY: Motion.pressTranslate }] },
                ]}>
                <Text style={styles.importConfirmSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Text accessibilityRole="header" style={styles.viewfinderTitle}>
              {setMode ? 'Show the whole set' : second ? 'Centre the number' : 'Show us the pattern'}
            </Text>
            <Text style={styles.viewfinderBlurb}>
              {setMode
                ? 'Fill the frame with one nested set. Keep every piece visible and avoid glare.'
                : second
                ? 'The mark on the underside settles the form. Hold steady, and centre it in the ring.'
                : 'Whole dish in frame, no glare. The backstamp comes next.'}
            </Text>
          </>
        )}
      </View>

      <View style={[styles.shutterRow, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.three }]}>
        <SideControl
          glyph={second ? '‹' : undefined}
          onPress={second ? onBack : undefined}
          accessibilityLabel="Back to the pattern shot"
          accessibilityHint="Discards the pattern photo and starts the burst again"
        />
        <Pressable
          accessibilityLabel={
            setMode ? 'Capture the whole set' : second ? 'Capture the backstamp' : 'Capture the pattern'
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onCapture}
          style={({ pressed }) => [
            styles.shutter,
            { backgroundColor: busy ? CameraChrome.guidePressed : CameraChrome.guide },
            !pressed && !busy && elevation.shutter,
            pressed && { transform: [{ translateY: Motion.pressTranslate }] },
          ]}
        />
        <SideControl
          glyph="Skip"
          onPress={second ? onSkip : undefined}
          accessibilityLabel="Skip the backstamp shot"
          accessibilityHint="Identifies from the pattern photo alone"
        />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 2 · the wait

/** 900ms linear, forever, until `/identify` answers. */
function SpinRing() {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    turn.value = withRepeat(
      withTiming(1, { duration: RING_SPIN_MS, easing: Easing.linear }),
      -1,
    );
  }, [reduced, turn]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 360}deg` }],
  }));

  return <Animated.View style={[styles.spinRing, animated]} />;
}

function PulseDot({ delay }: { delay: number }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withDelay(
      delay,
      withRepeat(withTiming(0.25, { duration: DOT_PULSE_MS / 2 }), -1, true),
    );
  }, [delay, pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[styles.dot, animated]} />;
}

/**
 * The wait, named. In the prototype this runs on a 1500ms timer; here it is on screen
 * for exactly as long as the request it describes is in flight.
 */
export function IdentifyingScreen({
  title,
  caption,
  banner,
}: {
  title: string;
  caption: string;
  banner: string | null;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityLabel={`${title}. ${caption}`}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[styles.ground, styles.identifying]}>
      <SpinRing />
      <Text accessibilityRole="header" style={styles.identifyingTitle}>
        {title}
      </Text>
      <Text style={styles.identifyingCaption}>{caption}</Text>
      <View style={styles.dots}>
        {[0, DOT_STAGGER_MS, DOT_STAGGER_MS * 2].map((delay) => (
          <PulseDot key={delay} delay={delay} />
        ))}
      </View>
      <View style={[styles.identifyingBanner, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}>
        <ScanBanner message={banner} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: CameraChrome.ground },
  flash: { backgroundColor: CameraChrome.flash, pointerEvents: 'none' },
  inert: { pointerEvents: 'none' },

  banner: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three - Spacing.half,
    paddingVertical: Spacing.three - Spacing.one,
  },
  bannerDot: { borderRadius: Radius.pill, height: 10, width: 10 },
  bannerText: { ...Type.caption, color: OnAccent.text, flex: 1 },

  footer: {
    gap: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.four + Spacing.two,
  },

  // --- 7
  permissionBody: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four + Spacing.two,
  },
  permissionTile: {
    alignItems: 'center',
    backgroundColor: CameraChrome.fill,
    borderRadius: PERMISSION_TILE_RADIUS,
    height: PERMISSION_TILE,
    justifyContent: 'center',
    width: PERMISSION_TILE,
  },
  permissionRing: {
    borderColor: CameraChrome.guide,
    borderRadius: PERMISSION_RING / 2,
    borderWidth: RING_STROKE,
    height: PERMISSION_RING,
    width: PERMISSION_RING,
  },
  permissionTitle: {
    ...Type.title,
    color: CameraChrome.text,
    fontSize: 30,
    lineHeight: 35,
    marginTop: Spacing.four + Spacing.one,
    textAlign: 'center',
  },
  permissionBlurb: {
    ...Type.body,
    color: CameraChrome.textDim,
    lineHeight: 23,
    marginTop: Spacing.two + Spacing.half,
    textAlign: 'center',
  },

  // --- 0 / 1
  viewfinderHead: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four - Spacing.half,
  },
  headRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headLabel: { ...Type.label, color: CameraChrome.guide, letterSpacing: 1.6 },
  headCount: { ...Type.caption, color: CameraChrome.textFaint, fontSize: 11 },
  modeControls: { flexDirection: 'row', gap: Spacing.two },
  modeToggle: {
    backgroundColor: CameraChrome.fill,
    borderColor: CameraChrome.frameEdge,
    borderRadius: Radius.md,
    borderWidth: Rule,
    flex: 1,
    flexDirection: 'row',
    padding: Spacing.one,
  },
  modeOption: {
    alignItems: 'center',
    borderRadius: Radius.xs,
    flex: 1,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.two,
  },
  modeOptionSelected: { backgroundColor: CameraChrome.guide },
  modeLabel: { ...Type.bodyStrong, color: CameraChrome.textDim },
  modeLabelSelected: { color: CameraChrome.ground },
  importAction: {
    alignItems: 'center',
    backgroundColor: CameraChrome.fill,
    borderColor: CameraChrome.frameEdge,
    borderRadius: Radius.md,
    borderWidth: Rule,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
  },
  importActionText: { ...Type.bodyStrong, color: CameraChrome.text },

  frame: {
    aspectRatio: VIEWFINDER_ASPECT,
    flexShrink: 1,
    minHeight: 220,
    backgroundColor: CameraChrome.frameFill,
    borderColor: CameraChrome.frameEdge,
    borderRadius: Radius.xxl,
    borderStyle: 'dashed',
    borderWidth: 2,
    marginHorizontal: VIEWFINDER_INSET,
    marginTop: Spacing.three - Spacing.half,
    overflow: 'hidden',
  },
  guideWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  guide: {
    alignItems: 'center',
    aspectRatio: 1,
    borderColor: CameraChrome.guide,
    borderWidth: GUIDE_STROKE,
    justifyContent: 'center',
  },
  guideSquare: { borderRadius: GUIDE_RADIUS, width: SQUARE_GUIDE_FRACTION },
  guideCircle: { borderRadius: Radius.pill, width: CIRCLE_GUIDE_FRACTION },
  guideGlyph: { ...Type.display, color: CameraChrome.ghost, fontSize: 40, lineHeight: 44 },

  viewfinderCopy: {
    // Content-sized and unshrinkable: when the queue banner appears above the
    // frame, the FRAME yields (flexShrink below), never the instructions. Plain
    // flex: 1 has a zero basis, so a tight column collapsed the title to a sliver.
    flexBasis: 'auto',
    flexGrow: 1,
    flexShrink: 0,
    paddingHorizontal: Spacing.four + Spacing.one,
    paddingTop: Spacing.four + Spacing.half,
  },
  viewfinderTitle: {
    ...Type.title,
    color: CameraChrome.text,
    fontSize: 29,
    letterSpacing: -0.4,
    lineHeight: 33,
  },
  viewfinderBlurb: {
    ...Type.body,
    color: CameraChrome.textDim,
    marginTop: Spacing.two,
  },
  importConfirm: {
    backgroundColor: CameraChrome.fill,
    borderColor: CameraChrome.frameEdge,
    borderRadius: Radius.md,
    borderWidth: Rule,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  importConfirmTitle: { ...Type.headline, color: CameraChrome.text },
  importConfirmCopy: { ...Type.callout, color: CameraChrome.textDim },
  importConfirmActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  importConfirmPrimary: {
    alignItems: 'center',
    backgroundColor: CameraChrome.guide,
    borderRadius: Radius.xs,
    flex: 1,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.two,
  },
  importConfirmPrimaryText: { ...Type.bodyStrong, color: CameraChrome.ground },
  importConfirmSecondary: {
    alignItems: 'center',
    backgroundColor: CameraChrome.fill,
    borderColor: CameraChrome.frameEdge,
    borderRadius: Radius.xs,
    borderWidth: Rule,
    flex: 1,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.two,
  },
  importConfirmSecondaryText: { ...Type.bodyStrong, color: CameraChrome.text },

  shutterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four + Spacing.one,
  },
  sideControl: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: SIDE_CONTROL,
    justifyContent: 'center',
    width: SIDE_CONTROL,
  },
  sideControlFilled: { backgroundColor: CameraChrome.fill },
  sideControlGlyph: { ...Type.bodyStrong, color: CameraChrome.text, fontSize: 12, lineHeight: 16 },
  shutter: { borderRadius: Radius.pill, height: SHUTTER, width: SHUTTER },

  // --- 2
  identifying: {
    alignItems: 'center',
    gap: Spacing.four - Spacing.half,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four + Spacing.two,
  },
  spinRing: {
    borderColor: CameraChrome.ring,
    borderRadius: SPIN_RING / 2,
    borderTopColor: CameraChrome.guide,
    borderWidth: RING_STROKE,
    height: SPIN_RING,
    width: SPIN_RING,
  },
  identifyingTitle: { ...Type.title, color: CameraChrome.text, fontSize: 24, lineHeight: 29 },
  identifyingCaption: {
    ...Type.callout,
    color: CameraChrome.textFaint,
    maxWidth: 240,
    textAlign: 'center',
  },
  dots: { flexDirection: 'row', gap: DOT_GAP },
  dot: {
    backgroundColor: CameraChrome.guide,
    borderRadius: Radius.pill,
    height: DOT,
    width: DOT,
  },
  identifyingBanner: {
    bottom: 0,
    left: Spacing.four + Spacing.two,
    position: 'absolute',
    right: Spacing.four + Spacing.two,
  },
});

/**
 * The lit half of the scan flow: what the identifier came back with, what happened when
 * you filed it, and the two ways out when it guessed wrong.
 *
 * These screens are on the app ground and read the app palette, so they compose from
 * `collection-ui` rather than restating it, `Card`, `PressButton`, `HeaderBar`,
 * `SpecimenTile` and `Label` carry every surface, button, band, tile and eyebrow here.
 *
 * The one thing built locally is the "Filed away" ledger. `PriceFigure` welds a figure
 * to its source label, which is the rule that matters, but it renders in app text
 * colors and that ledger sits on a solid avocado field. `LedgerFigure` below is the
 * same contract in `OnAccent`: `source` is a required prop, so the figure cannot be
 * rendered bare there either.
 */

import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CatalogRow } from '@/db';
import { SWATCH_SOURCE_LABEL } from '@/constants/colorways';
import {
  CameraChrome,
  HitTarget,
  MaxContentWidth,
  Motion,
  OnAccent,
  Radius,
  Spacing,
  Type,
  offsetShadow,
} from '@/constants/theme';
import {
  Card,
  Divider,
  HeaderBar,
  Label,
  PressButton,
  provenanceLabel,
  RarityBadge,
  SpecimenTile,
  useColors,
  useElevation,
} from '@/features/collection/collection-ui';
import type { Form, Pattern, ScanGuess } from '@shared/types';
import { ScanBanner, TAB_BAR_CLEARANCE } from './scan-camera';
import { browseDetailFacts, type GroupedDetection } from './logic';

export const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Prototype geometry, declared final by the handoff. */
const EVIDENCE_ASPECT = 1.2;
const CANDIDATE_TILE = 62;
const SHEET_TILE = 72;
const CHECK_DISC = 104;
const GRAB_HANDLE_WIDTH = 44;
const GRAB_HANDLE_HEIGHT = 5;
const SELECT_BORDER = 2;
/** The fade the pinned footer sits over. Native only; see the note on `styles.fade`. */
const FOOTER_FADE = 28;

/** The handoff's three-step entrance. `Motion` has no delay tokens, so these are its. */
const RISE_DELAYS = [120, 200, 280] as const;

/**
 * `shape · modelNo`, with U+00A0 before the separator exactly where the prototype puts
 * its `&nbsp;`. That welds the dot to the form so a line never starts with a stray
 * separator, while leaving the model number free to wrap as its own unit.
 *
 * Welding *both* sides was tried and reverted: real catalog forms run to "Cinderella
 * round casserole", and one unbreakable 34-character token gets tail-ellipsised at the
 * model number, which is the single token this screen exists to tell apart.
 */
export function formCaption(row: Pick<CatalogRow, 'shape' | 'modelNo'>): string {
  return `${row.shape} · ${row.modelNo}`;
}

/**
 * Fade and rise, 14px. The only motion on the confirmation screen, and it skips
 * straight to the resting state under reduced motion rather than running faster.
 *
 * The handoff asks for 360ms. `Motion` has no token there: `settle` is 240 and
 * `transition` (380) is reserved by the lock for whole-screen moves, so this runs at
 * `settle` rather than inventing a duration.
 */
function Rise({ delay = 0, children, style }: {
  delay?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: Motion.settle, easing: Easing.bezier(...Motion.easing) }),
    );
  }, [delay, progress, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * Motion.enterOffset }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

// ------------------------------------------------------------------ 3 · pick a match

/** One captured frame with its corner label. The evidence the guesses were drawn from. */
function EvidenceThumb({ uri, label }: { uri: string | undefined; label: string }) {
  const colors = useColors();

  return (
    <View style={styles.evidence}>
      {uri ? (
        <Image
          accessibilityLabel={`${label} photo captured`}
          contentFit="cover"
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          transition={Motion.enter}
        />
      ) : (
        <View
          accessibilityLabel={`No ${label.toLowerCase()} photo`}
          style={[StyleSheet.absoluteFill, styles.evidenceEmpty]}
        />
      )}
      <View style={[styles.evidenceLabel, { backgroundColor: colors.scrim }]}>
        <Text style={styles.evidenceLabelText}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * A guess as a row you choose rather than one you fire. Selection draws a 2px avocado
 * border and the unselected rows carry a 2px transparent one, so picking a different
 * row moves nothing on the screen.
 */
function CandidateRow({
  guess,
  row,
  selected,
  onPress,
}: {
  guess: ScanGuess;
  row: CatalogRow;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const percent = Math.round(guess.confidence * 100);

  return (
    <Pressable
      accessibilityHint={guess.reasoning}
      accessibilityLabel={`${row.patternName}, ${row.shape}, model ${row.modelNo}, ${percent}% match`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => pressed && { transform: [{ translateY: Motion.pressTranslate }] }}>
      {({ pressed }) => (
        <Card
          raised
          style={[
            styles.candidate,
            { borderColor: selected ? colors.accent : 'transparent' },
            pressed && offsetShadow(0, 'transparent'),
          ]}>
          <SpecimenTile
            colorway={row.colorway}
            modelNo={row.modelNo}
            patternName={row.patternName}
            stampSize="small"
            style={styles.candidateTile}
          />
          <View style={styles.candidateCopy}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
              {row.patternName}
            </Text>
            <Text numberOfLines={2} style={[styles.rowCaption, { color: colors.textSecondary }]}>
              {formCaption(row)}
            </Text>
          </View>
          <View style={styles.candidateScore}>
            <Text
              style={[
                styles.scoreValue,
                { color: selected ? colors.accent : colors.textTertiary },
              ]}>
              {percent}%
            </Text>
            <Text style={[styles.scoreNote, { color: colors.textTertiary }]}>match</Text>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

export function ResultScreen({
  photoUris,
  candidates,
  selectedSlug,
  selectedPattern,
  banner,
  problem,
  busy,
  onSelect,
  onConfirm,
  onWant,
  onNone,
  onRetake,
}: {
  photoUris: string[];
  candidates: { guess: ScanGuess; row: CatalogRow }[];
  selectedSlug: string | null;
  selectedPattern: Pattern | null;
  banner: string | null;
  problem: string | null;
  busy: boolean;
  onSelect: (slug: string) => void;
  onConfirm: () => void;
  onWant: () => void;
  onNone: () => void;
  onRetake: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const lead = candidates[0]?.row;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
        <HeaderBar
          label={photoUris.length > 1 ? 'Two shots read' : 'One shot read'}
          right={
            <Pressable
              accessibilityLabel="Retake the photos"
              accessibilityRole="button"
              hitSlop={Spacing.three}
              onPress={onRetake}>
              <Text style={[styles.retake, { color: colors.want }]}>Retake</Text>
            </Pressable>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.resultContent,
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + HitTarget * 2 + Spacing.six },
        ]}>
        <View style={styles.evidenceRow}>
          <EvidenceThumb uri={photoUris[0]} label="Pattern" />
          <EvidenceThumb uri={photoUris[1]} label="Backstamp" />
        </View>

        <View style={styles.resultCopy}>
          <Text accessibilityRole="header" style={[styles.resultTitle, { color: colors.text }]}>
            We think it’s this
          </Text>
          <Text style={[styles.resultBlurb, { color: colors.textSecondary }]}>
            {lead
              ? `The ${lead.modelNo} narrows it to ${candidates.length}. Pick the one in your hands.`
              : 'Pick the one in your hands.'}
          </Text>
        </View>

        <ScanBanner message={banner} />
        <ScanBanner message={problem} tone="problem" />

        <View accessibilityRole="radiogroup" style={styles.candidateStack}>
          {candidates.map(({ guess, row }) => {
            const selected = row.slug === selectedSlug;
            return (
              <View key={row.slug} style={styles.candidateGroup}>
                <CandidateRow
                  guess={guess}
                  row={row}
                  selected={selected}
                  onPress={() => onSelect(row.slug)}
                />
                {selected && selectedPattern && (
                  <View
                    accessible
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={[
                      selectedPattern.colorway ?? 'Colorway not documented',
                      selectedPattern.notes,
                    ].filter(Boolean).join('. ')}
                    style={styles.candidateDescription}>
                    <Text
                      style={[styles.candidateDescriptionText, { color: colors.textSecondary }]}>
                      {selectedPattern.colorway ?? 'Colorway not documented'}
                    </Text>
                    {selectedPattern.notes && (
                      <Text
                        style={[styles.candidateDescriptionText, { color: colors.textSecondary }]}>
                        {selectedPattern.notes}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* The want list is not in the prototype's scan flow, and dropping it silently
            would have removed the only way to note a piece you did not buy. */}
        <Pressable
          accessibilityHint="Files the selected piece on your want list instead of your shelf"
          accessibilityLabel="Add to my want list instead"
          accessibilityRole="button"
          disabled={!selectedSlug || busy}
          hitSlop={Spacing.two}
          onPress={onWant}
          style={styles.wantLink}>
          <Text
            style={[
              styles.wantLinkText,
              { color: selectedSlug && !busy ? colors.spice : colors.textTertiary },
            ]}>
            Add to my want list instead
          </Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.fade,
          {
            bottom: footerHeight,
            experimental_backgroundImage: `linear-gradient(180deg, transparent, ${colors.background})`,
          },
        ]}
      />
      <View
        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        style={[
          styles.resultFooter,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.half },
        ]}>
        <PressButton
          tone="primary"
          disabled={!selectedSlug || busy}
          onPress={onConfirm}
          accessibilityLabel="That's the one"
          style={styles.grow}>
          That’s the one
        </PressButton>
        <PressButton
          tone="quiet"
          onPress={onNone}
          accessibilityLabel="None of these"
          accessibilityHint="Opens the catalog saved on this phone">
          None
        </PressButton>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ set results

export interface SetResultItem {
  group: GroupedDetection;
  row: CatalogRow;
}

function SetResultRow({
  item,
  onDetails,
  onRemove,
  onWrong,
}: {
  item: SetResultItem;
  onDetails: () => void;
  onRemove: () => void;
  onWrong: () => void;
}) {
  const colors = useColors();
  const [pressed, setPressed] = useState(false);
  const { group, row } = item;

  return (
    <Card
      style={[
        styles.setRow,
        pressed && { transform: [{ translateY: Motion.pressTranslate }] },
      ]}>
      <View style={styles.setRowHead}>
        <Pressable
          accessibilityLabel={`Show ${row.patternName}, model ${row.modelNo} details`}
          accessibilityRole="button"
          onPress={onDetails}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={styles.setRowMain}>
          <SpecimenTile
            colorway={row.colorway}
            modelNo={row.modelNo}
            patternName={row.patternName}
            stampSize="small"
            style={styles.candidateTile}
          />
          <View style={styles.grow}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
              {row.patternName}
            </Text>
            <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>
              {formCaption(row)}
            </Text>
          </View>
          {group.count > 1 && (
            <View style={[styles.countMarker, { backgroundColor: colors.backgroundElement }]}>
              <Text style={[styles.countMarkerText, { color: colors.spice }]}>×{group.count}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.setRowActions}>
          <PressButton
            tone="quiet"
            onPress={onWrong}
            accessibilityLabel={`Mark ${row.patternName}, model ${row.modelNo} as wrong and find the correct match`}
            style={styles.setRowAction}
            textStyle={styles.setRowActionText}>
            Wrong
          </PressButton>
          <PressButton
            tone="quiet"
            onPress={onRemove}
            accessibilityLabel={`Remove ${row.patternName}, model ${row.modelNo}`}
            style={styles.setRowAction}
            textStyle={styles.setRowActionText}>
            Remove
          </PressButton>
        </View>
      </View>
      <Divider />
      <View style={styles.setEvidenceCopy}>
        <Label tone="tertiary">Model reported</Label>
        {group.evidence.map((evidence, index) => (
          <Text
            key={`${evidence}-${index}`}
            style={[styles.evidenceClaim, { color: colors.textSecondary }]}>
            • {evidence}
          </Text>
        ))}
      </View>
    </Card>
  );
}

export function SetResultsScreen({
  photoUri,
  items,
  contradicted,
  banner,
  problem,
  onDetails,
  onRemove,
  onWrong,
  onFile,
  onRetake,
}: {
  photoUri: string | undefined;
  items: SetResultItem[];
  contradicted: number;
  banner: string | null;
  problem: string | null;
  onDetails: (row: CatalogRow) => void;
  onRemove: (slug: string) => void;
  onWrong: (slug: string) => void;
  onFile: () => void;
  onRetake: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const pieceCount = items.reduce((total, item) => total + item.group.count, 0);
  const pieceLabel = `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'}`;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
        <HeaderBar label={`${pieceLabel} to file`} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.resultContent,
          { paddingBottom: footerHeight + Spacing.four },
        ]}>
        <View style={styles.evidenceRow}>
          <EvidenceThumb uri={photoUri} label="Whole set" />
        </View>

        <View style={styles.resultCopy}>
          <Text accessibilityRole="header" style={[styles.resultTitle, { color: colors.text }]}>
            Review the set
          </Text>
          <Text style={[styles.resultBlurb, { color: colors.textSecondary }]}>
            Correct or remove any wrong matches. Everything left will be filed together.
          </Text>
        </View>

        <ScanBanner message={banner} />
        <ScanBanner message={problem} tone="problem" />

        {contradicted > 0 && (
          <Text style={[styles.contradictedNote, { color: colors.textSecondary }]}>
            {contradicted} {contradicted === 1 ? 'piece did' : 'pieces did'} not match{' '}
            {contradicted === 1 ? 'its pattern’s' : 'their patterns’'} documented colors and{' '}
            {contradicted === 1 ? 'was' : 'were'} set aside for single scanning.
          </Text>
        )}

        {items.length > 0 ? (
          <View style={styles.candidateStack}>
            {items.map((item) => (
              <SetResultRow
                item={item}
                key={item.group.itemSlug}
                onDetails={() => onDetails(item.row)}
                onRemove={() => onRemove(item.group.itemSlug)}
                onWrong={() => onWrong(item.group.itemSlug)}
              />
            ))}
          </View>
        ) : (
          <Card style={styles.setEmpty}>
            <Label tone="spice">Nothing left to file</Label>
            <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>
              Retake the set photo, or scan each dish one at a time to correct the pieces you
              removed.
            </Text>
          </Card>
        )}
      </ScrollView>

      <View
        style={[
          styles.fade,
          {
            bottom: footerHeight,
            experimental_backgroundImage: `linear-gradient(180deg, transparent, ${colors.background})`,
          },
        ]}
      />
      <View
        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        style={[
          styles.setResultFooter,
          {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.half,
          },
        ]}>
        <PressButton
          tone="primary"
          disabled={items.length === 0}
          onPress={onFile}
          accessibilityLabel={`File ${pieceLabel}`}>
          File {pieceLabel}
        </PressButton>
        <PressButton tone="quiet" onPress={onRetake} accessibilityLabel="Retake the set photo">
          Retake photo
        </PressButton>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 4 · filed away

/**
 * The confirmation check. Overshoots to 1.08 and settles, which is the one place in
 * this app anything scales, `Motion.pressScale` is 1 everywhere else on purpose.
 */
function CheckDisc() {
  const reduced = useReducedMotion();
  const colors = useColors();
  const scale = useSharedValue(reduced ? 1 : 0.6);
  const opacity = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      scale.value = 1;
      return;
    }
    const easing = Easing.bezier(...Motion.easing);
    opacity.value = withTiming(1, { duration: Motion.pop * 0.6, easing });
    // 0.6 -> 1.08 -> 1: the overshoot the handoff specifies, split 60/40 across `pop`.
    scale.value = withSequence(
      withTiming(1.08, { duration: Motion.pop * 0.6, easing }),
      withTiming(1, { duration: Motion.pop * 0.4, easing }),
    );
  }, [opacity, reduced, scale]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.checkDisc, { backgroundColor: colors.want }, animated]}>
      <Text style={[styles.checkGlyph, { color: colors.text }]}>✓</Text>
    </Animated.View>
  );
}

/**
 * A figure on the avocado field, with the claim behind it.
 *
 * `source` is required rather than optional for the same reason `PriceFigure` welds its
 * label: a shelf total quoted from sold comps and one quoted from asking prices are
 * different assertions, and a figure that does not say which is not honest. When there
 * is nothing to quote the figure is an em dash and `source` says why.
 */
function LedgerFigure({
  label,
  figure,
  source,
  gold = false,
}: {
  label: string;
  figure: string;
  source: string;
  gold?: boolean;
}) {
  const colors = useColors();

  return (
    <View style={styles.ledgerCell}>
      <Text style={styles.ledgerLabel}>{label}</Text>
      {/* nowrap, so the two figures sit on one baseline instead of one of them
          wrapping and dragging its cell taller than its neighbour. */}
      <Text
        numberOfLines={1}
        style={[styles.ledgerFigure, { color: gold ? colors.want : OnAccent.text }]}>
        {figure}
      </Text>
      <Text style={styles.ledgerSource}>{source}</Text>
    </View>
  );
}

export interface FiledLedger {
  /** The piece's own comparable range, already formatted, or null when there is none. */
  itemFigure: string | null;
  itemSource: string;
  shelfFigure: string | null;
  shelfSource: string;
  pieceNote: string;
}

export function FiledScreen({
  headline,
  ledger,
  onSeeFile,
  onScanAnother,
}: {
  headline: string;
  ledger: FiledLedger;
  onSeeFile: () => void;
  onScanAnother: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { backgroundColor: colors.accent }]}>
      <View style={[styles.filedBody, { paddingTop: insets.top + Spacing.six }]}>
        <CheckDisc />
        <Rise delay={RISE_DELAYS[0]}>
          <Text accessibilityRole="header" style={styles.filedTitle}>
            Filed away
          </Text>
        </Rise>
        <Rise delay={RISE_DELAYS[1]}>
          <Text style={styles.filedBlurb}>{headline}</Text>
        </Rise>
      </View>

      <Rise delay={RISE_DELAYS[2]} style={styles.ledgerWrap}>
        <View style={styles.ledger}>
          <LedgerFigure
            label="Worth about"
            figure={ledger.itemFigure ?? 'Unavailable'}
            source={ledger.itemSource}
          />
          {/* `Divider` reads on `colors.divider`, which all but vanishes on avocado. */}
          <View style={styles.ledgerRule} />
          <LedgerFigure
            gold
            label="Shelf total"
            figure={ledger.shelfFigure ?? 'Unavailable'}
            source={ledger.shelfSource}
          />
        </View>
        <Text style={styles.ledgerNote}>{ledger.pieceNote}</Text>
      </Rise>

      <View style={[styles.filedFooter, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.five }]}>
        <PressButton tone="gold" onPress={onSeeFile} accessibilityLabel="See my file">
          See my file
        </PressButton>
        <PressButton tone="translucent" onPress={onScanAnother} accessibilityLabel="Scan another">
          Scan another
        </PressButton>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 8 · browse by hand

function GridCell({ row, onPress }: { row: CatalogRow; onPress: () => void }) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityHint="Opens pattern details before adding it to your collection"
      accessibilityLabel={`${row.patternName}, ${row.shape}, model ${row.modelNo}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.gridCell,
        pressed && { transform: [{ translateY: Motion.pressTranslate }] },
      ]}>
      {({ pressed }) => (
        <Card style={[styles.gridCard, pressed && offsetShadow(0, 'transparent')]}>
          <SpecimenTile
            colorway={row.colorway}
            modelNo={row.modelNo}
            patternName={row.patternName}
            style={styles.gridTile}
          />
          <Text numberOfLines={1} style={[styles.gridName, { color: colors.text }]}>
            {row.patternName}
          </Text>
          <Text numberOfLines={1} style={[styles.gridModel, { color: colors.textSecondary }]}>
            {row.modelNo}
          </Text>
        </Card>
      )}
    </Pressable>
  );
}

/**
 * The catalog by hand: the fallback when the identifier is unsure, when it is wrong, and
 * when the camera was declined outright. It reads the copy saved on the phone, so it is
 * the one screen in this flow that works with no signal at all.
 */
export function BrowseScreen({
  rows,
  total,
  query,
  onQuery,
  shapes,
  shapeFilter,
  onShapeFilter,
  banner,
  problem,
  offline,
  unknownName,
  onUnknownName,
  onSubmitUnknown,
  onAddKnownCombination,
  onBack,
  onPick,
}: {
  rows: CatalogRow[];
  total: number;
  query: string;
  onQuery: (value: string) => void;
  shapes: string[];
  shapeFilter: string | null;
  onShapeFilter: (shape: string | null) => void;
  banner: string | null;
  problem: string | null;
  offline: boolean;
  unknownName: string;
  onUnknownName: (value: string) => void;
  onSubmitUnknown: () => void;
  onAddKnownCombination: () => void;
  onBack: () => void;
  onPick: (row: CatalogRow) => void;
}) {
  const colors = useColors();
  const elevation = useElevation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
        <HeaderBar
          onBack={onBack}
          label={`All ${total} ${total === 1 ? 'piece' : 'pieces'}`}
        />
      </View>

      <FlatList
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[
          styles.browseContent,
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.six },
        ]}
        data={rows}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.slug}
        numColumns={2}
        renderItem={({ item }) => <GridCell row={item} onPress={() => onPick(item)} />}
        ListHeaderComponent={
          <View style={styles.browseHead}>
            <ScanBanner message={banner} />
            <ScanBanner message={problem} tone="problem" />
            <View style={[styles.search, { backgroundColor: colors.surface }, elevation.card]}>
              <TextInput
                accessibilityLabel="Search the catalog saved on this phone"
                accessibilityRole="search"
                autoCapitalize="words"
                onChangeText={onQuery}
                placeholder="Pattern, form or model number…"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.text }]}
                value={query}
              />
            </View>
            {shapes.length > 0 && (
              <View style={styles.chips}>
                {shapes.map((shape) => {
                  const active = shape === shapeFilter;
                  return (
                    <Pressable
                      accessibilityLabel={`Filter by ${shape}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      hitSlop={Spacing.two}
                      key={shape}
                      onPress={() => onShapeFilter(active ? null : shape)}
                      style={[
                        styles.chip,
                        { backgroundColor: active ? colors.accent : colors.backgroundElement },
                      ]}>
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.accentText : colors.textSecondary },
                        ]}>
                        {shape}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.emptyNote, { color: colors.textSecondary }]}>
            Nothing in the saved catalog matches that. Name it yourself below.
          </Text>
        }
        ListFooterComponent={
          <View style={styles.catalogGrowth}>
            <Card style={styles.unknownCard}>
              <Label tone="spice">Known pattern, new form</Label>
              <Text accessibilityRole="header" style={[styles.rowTitle, { color: colors.text }]}>
                Add a missing combination
              </Text>
              <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>
                Use this when both the pattern and form are known, but this pairing is missing.
                Adding it shares the combination with everyone and needs a connection.
              </Text>
              <PressButton
                tone="quiet"
                onPress={onAddKnownCombination}
                accessibilityLabel="Add a known pattern in a new form">
                Add a known pattern in a new form
              </PressButton>
            </Card>

            <Card style={styles.unknownCard}>
              <Label tone="spice">Not catalogued</Label>
              <Text accessibilityRole="header" style={[styles.rowTitle, { color: colors.text }]}>
                Name it yourself
              </Text>
              <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>
                Name it in your own words. Creating the catalog entry needs a connection.
              </Text>
              <TextInput
                accessibilityLabel="Name the unknown pattern"
                autoCapitalize="words"
                onChangeText={onUnknownName}
                placeholder="Pattern name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                style={[
                  styles.unknownInput,
                  { backgroundColor: colors.background, color: colors.text },
                ]}
                value={unknownName}
              />
              <PressButton
                tone="quiet"
                disabled={offline}
                onPress={onSubmitUnknown}
                accessibilityLabel={offline ? 'Connect to submit a new pattern' : 'Submit new pattern'}>
                {offline ? 'Connect to submit a new pattern' : 'Submit new pattern'}
              </PressButton>
            </Card>
          </View>
        }
      />
    </View>
  );
}

export function KnownCombinationScreen({
  patterns,
  forms,
  selectedPatternId,
  selectedFormId,
  query,
  banner,
  problem,
  offline,
  onQuery,
  onPattern,
  onForm,
  onBack,
  onConfirm,
}: {
  patterns: Pick<Pattern, 'id' | 'name'>[];
  forms: Pick<Form, 'id' | 'shape' | 'modelNo'>[];
  selectedPatternId: string | null;
  selectedFormId: string | null;
  query: string;
  banner: string | null;
  problem: string | null;
  offline: boolean;
  onQuery: (value: string) => void;
  onPattern: (patternId: string) => void;
  onForm: (formId: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  const elevation = useElevation();
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const selectedPattern = patterns.find((pattern) => pattern.id === selectedPatternId) ?? null;
  const selectedForm = forms.find((form) => form.id === selectedFormId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const choices = selectedPattern
    ? forms.filter((form) =>
        !normalizedQuery ||
        form.shape.toLowerCase().includes(normalizedQuery) ||
        form.modelNo.toLowerCase().includes(normalizedQuery),
      )
    : patterns.filter((pattern) =>
        !normalizedQuery || pattern.name.toLowerCase().includes(normalizedQuery),
      );
  const step = selectedForm ? 3 : selectedPattern ? 2 : 1;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
        <HeaderBar onBack={onBack} label="Add a missing combination" />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.combinationContent,
          {
            paddingBottom: selectedForm
              ? footerHeight + Spacing.four
              : insets.bottom + TAB_BAR_CLEARANCE + Spacing.six,
          },
        ]}
        keyboardShouldPersistTaps="handled">
        <ScanBanner message={banner} />
        <ScanBanner message={problem} tone="problem" />

        <Card style={styles.combinationIntro}>
          <Label tone="tertiary">Step {step} of 3</Label>
          <Text accessibilityRole="header" style={[styles.rowTitle, { color: colors.text }]}>
            {selectedForm ? 'Confirm the combination' : selectedPattern ? 'Choose the form' : 'Choose the pattern'}
          </Text>
          <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>
            {selectedForm
              ? 'Confirming adds this pattern and form pairing to the shared catalog for everyone, then files the piece on your shelf.'
              : selectedPattern
                ? `Choose the existing form used by this ${selectedPattern.name} piece.`
                : 'Search the patterns already saved on this phone.'}
          </Text>
        </Card>

        {selectedForm && selectedPattern ? (
          <Card raised style={styles.combinationSummary}>
            <View style={styles.browseDetailSection}>
              <Label tone="tertiary">Pattern</Label>
              <Text style={[styles.browseDetailFact, { color: colors.text }]}>
                {selectedPattern.name}
              </Text>
            </View>
            <Divider />
            <View style={styles.browseDetailSection}>
              <Label tone="tertiary">Form</Label>
              <Text style={[styles.browseDetailFact, { color: colors.text }]}>
                {formCaption(selectedForm)}
              </Text>
            </View>
            <Divider />
            <Label tone="tertiary">{provenanceLabel('collector-attested')}</Label>
          </Card>
        ) : (
          <>
            <View style={[styles.search, { backgroundColor: colors.surface }, elevation.card]}>
              <TextInput
                accessibilityLabel={selectedPattern ? 'Search existing forms' : 'Search known patterns'}
                accessibilityRole="search"
                autoCapitalize="words"
                onChangeText={onQuery}
                placeholder={selectedPattern ? 'Form or model number…' : 'Pattern name…'}
                placeholderTextColor={colors.textTertiary}
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.text }]}
                value={query}
              />
            </View>

            <View style={styles.combinationChoices}>
              {choices.map((choice) => {
                const isForm = 'modelNo' in choice;
                const label = isForm ? formCaption(choice) : choice.name;
                return (
                  <Pressable
                    accessibilityLabel={`Choose ${label}`}
                    accessibilityRole="button"
                    key={choice.id}
                    onPress={() => isForm ? onForm(choice.id) : onPattern(choice.id)}
                    style={({ pressed }) => [
                      pressed && { transform: [{ translateY: Motion.pressTranslate }] },
                    ]}>
                    {({ pressed }) => (
                      <Card style={[styles.combinationChoice, pressed && offsetShadow(0, 'transparent')]}>
                        <Text style={[styles.rowTitle, { color: colors.text }]}>{label}</Text>
                      </Card>
                    )}
                  </Pressable>
                );
              })}
              {choices.length === 0 && (
                <Text style={[styles.emptyNote, { color: colors.textSecondary }]}>
                  {selectedPattern
                    ? `Every existing form is already catalogued for ${selectedPattern.name}.`
                    : 'No saved patterns match that search.'}
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {selectedForm && (
        <View
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          style={[
            styles.resultFooter,
            {
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.half,
            },
          ]}>
          <PressButton
            tone="primary"
            disabled={offline}
            onPress={onConfirm}
            accessibilityLabel={offline
              ? 'Connect to add this combination to the shared catalog'
              : 'Add this combination to the shared catalog and my shelf'}
            style={styles.grow}>
            {offline ? 'Connect to add this combination' : 'Add to the shared catalog'}
          </PressButton>
        </View>
      )}
    </View>
  );
}

type BrowseDetailActions =
  | { readOnly: true; actionLabel?: never; onAdd?: never }
  | { readOnly?: false; actionLabel: string; onAdd: () => void };

export function BrowseDetailScreen({
  row,
  pattern,
  form,
  banner,
  problem,
  readOnly = false,
  actionLabel,
  onAdd,
  onBack,
}: {
  row: CatalogRow;
  pattern: Pattern;
  form: Form | null;
  banner: string | null;
  problem: string | null;
  onBack: () => void;
} & BrowseDetailActions) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const { productionYears, measurements } = browseDetailFacts(pattern, form);
  const shape = form?.shape ?? row.shape;
  const modelNo = form?.modelNo ?? row.modelNo;
  const colorway = pattern.colorway ?? row.colorway;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
        <HeaderBar label="Pattern details" />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.browseDetailContent,
          { paddingBottom: footerHeight + Spacing.four },
        ]}>
        <ScanBanner message={banner} />
        <ScanBanner message={problem} tone="problem" />

        <Card raised style={styles.browseDetailCard}>
          <View style={styles.browseDetailSection}>
            <Label tone="spice">Pattern</Label>
            <Text accessibilityRole="header" style={[styles.browseDetailTitle, { color: colors.text }]}>
              {pattern.name}
            </Text>
            <Text style={[styles.browseDetailCaption, { color: colors.textSecondary }]}>
              {formCaption({ shape, modelNo })}
            </Text>
          </View>

          <Divider />

          <View style={styles.browseDetailFacts}>
            {productionYears && (
              <View style={styles.browseDetailSection}>
                <Label tone="tertiary">Production years</Label>
                <Text style={[styles.browseDetailFact, { color: colors.text }]}>
                  {productionYears}
                </Text>
              </View>
            )}
            {measurements && (
              <View style={styles.browseDetailSection}>
                <Label tone="tertiary">Capacity and size</Label>
                <Text style={[styles.browseDetailFact, { color: colors.text }]}>
                  {measurements}
                </Text>
              </View>
            )}
            <View style={styles.browseDetailSection}>
              <Label tone="tertiary">Rarity</Label>
              <RarityBadge rarity={row.rarity} />
            </View>
            <Label tone="tertiary">{provenanceLabel(row.provenance)}</Label>
          </View>

          <Divider />

          <View style={styles.browseDetailSection}>
            <Label tone="spice">Colorway</Label>
            <Text style={[styles.browseDetailBody, { color: colors.textSecondary }]}>
              {colorway ?? 'Colorway not documented'}
            </Text>
            <SpecimenTile
              colorway={colorway}
              modelNo={modelNo}
              patternName={pattern.name}
              stampSize="large"
              style={styles.browseDetailTile}
            />
            <Text style={[styles.browseDetailSource, { color: colors.textTertiary }]}>
              {SWATCH_SOURCE_LABEL}
            </Text>
          </View>

          {pattern.notes && (
            <>
              <Divider />
              <View style={styles.browseDetailSection}>
                <Label tone="spice">Identification notes</Label>
                <Text style={[styles.browseDetailBody, { color: colors.textSecondary }]}>
                  {pattern.notes}
                </Text>
              </View>
            </>
          )}
        </Card>
      </ScrollView>

      <View
        style={[
          styles.fade,
          {
            bottom: footerHeight,
            experimental_backgroundImage: `linear-gradient(180deg, transparent, ${colors.background})`,
          },
        ]}
      />
      <View
        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        style={[
          styles.resultFooter,
          {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.half,
          },
        ]}>
        {!readOnly && (
          <PressButton
            tone="primary"
            onPress={onAdd}
            accessibilityLabel={`${actionLabel}, ${pattern.name}, model ${modelNo}`}
            style={styles.grow}>
            {actionLabel}
          </PressButton>
        )}
        <PressButton
          tone="quiet"
          onPress={onBack}
          accessibilityLabel={readOnly ? 'Go back to set results' : 'Go back to catalog browse'}
          style={readOnly ? styles.grow : undefined}>
          Go back
        </PressButton>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 9 · already owned

/**
 * The duplicate case, as a sheet rather than a screen: you are still standing in the
 * aisle deciding whether to buy a second one, so the guesses stay visible behind it.
 */
export function AlreadyOwnedSheet({
  row,
  quantity,
  since,
  addLabel,
  onAdd,
  onOpen,
  onDismiss,
}: {
  row: CatalogRow;
  quantity: number;
  since: string | null;
  addLabel: string;
  onAdd: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // "last filed in March", not "since March": `since` comes from `updatedAt`, so
  // adding a second one last week would date the whole holding to last week.
  const detail = [
    `${row.patternName}, ${row.modelNo}`,
    `${quantity} on the shelf${since ? `, last filed in ${since}` : ''}.`,
  ].join('. ');

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
        onPress={onDismiss}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + Spacing.four + Spacing.two },
        ]}>
        <View style={[styles.grabHandle, { backgroundColor: colors.border }]} />
        <View style={styles.sheetHead}>
          <SpecimenTile
            colorway={row.colorway}
            modelNo={row.modelNo}
            patternName={row.patternName}
            stampSize="small"
            style={styles.sheetTile}
          />
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.text }]}>
              You already have this
            </Text>
            <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>{detail}</Text>
          </View>
        </View>
        <View style={styles.sheetActions}>
          <PressButton tone="primary" onPress={onAdd} style={styles.grow}>
            {addLabel}
          </PressButton>
          <PressButton tone="quiet" onPress={onOpen} style={styles.grow}>
            Just open the card
          </PressButton>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },

  rowTitle: { ...Type.headline },
  rowCaption: { ...Type.caption },

  // --- 3
  retake: { ...Type.bodyStrong, fontSize: 12, lineHeight: 14 },
  resultContent: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.three + Spacing.half,
    width: '100%',
  },
  evidenceRow: { flexDirection: 'row', gap: Spacing.two + Spacing.half },
  evidence: {
    aspectRatio: EVIDENCE_ASPECT,
    borderRadius: Radius.sm,
    flex: 1,
    overflow: 'hidden',
  },
  // Dark on purpose: it stands in for a camera frame, which is what CameraChrome is for.
  evidenceEmpty: { backgroundColor: CameraChrome.ground },
  evidenceLabel: {
    borderRadius: Radius.xs,
    bottom: Spacing.two,
    left: Spacing.two,
    paddingHorizontal: Spacing.two - Spacing.half,
    paddingVertical: Spacing.half,
    position: 'absolute',
  },
  evidenceLabelText: { ...Type.micro, color: OnAccent.text, fontSize: 9 },

  resultCopy: { gap: Spacing.one },
  resultTitle: { ...Type.title, lineHeight: 31 },
  resultBlurb: { ...Type.callout },

  candidateStack: { gap: Spacing.two + Spacing.half },
  candidateGroup: { gap: Spacing.two },
  candidate: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: SELECT_BORDER,
    flexDirection: 'row',
    gap: Spacing.three - Spacing.one,
    padding: Spacing.three - Spacing.one,
  },
  candidateTile: { height: CANDIDATE_TILE, width: CANDIDATE_TILE },
  candidateCopy: { flex: 1, gap: Spacing.half },
  candidateScore: { alignItems: 'flex-end', gap: Spacing.half },
  scoreValue: { ...Type.bodyStrong, fontSize: 12, lineHeight: 14 },
  scoreNote: { ...Type.caption, fontSize: 9, lineHeight: 13 },
  candidateDescription: { gap: Spacing.one, paddingHorizontal: Spacing.three },
  candidateDescriptionText: { ...Type.caption },

  wantLink: { alignItems: 'center', minHeight: HitTarget, justifyContent: 'center' },
  wantLinkText: { ...Type.bodyStrong, fontSize: 13 },

  setRow: { gap: Spacing.three - Spacing.one, padding: Spacing.three - Spacing.one },
  setRowHead: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  setRowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Spacing.two },
  countMarker: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    justifyContent: 'center',
    minHeight: Spacing.four,
    minWidth: Spacing.four,
    paddingHorizontal: Spacing.two,
  },
  countMarkerText: { ...Type.bodyStrong },
  setRowActions: { flexDirection: 'row', gap: Spacing.one },
  setRowAction: { paddingHorizontal: Spacing.two },
  setRowActionText: { fontSize: Type.caption.fontSize, lineHeight: Type.caption.lineHeight },
  setEvidenceCopy: { gap: Spacing.one },
  evidenceClaim: { ...Type.caption },
  contradictedNote: { ...Type.caption },
  setEmpty: { gap: Spacing.two, padding: Spacing.three },
  setResultFooter: {
    bottom: 0,
    gap: Spacing.two + Spacing.half,
    left: 0,
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.three - Spacing.half,
    position: 'absolute',
    right: 0,
  },

  // `experimental_backgroundImage` is the only gradient React Native 0.85 exposes and
  // react-native-web 0.21 does not implement it, so the browser preview shows a hard
  // edge here and the phone shows the fade. Unverified on a device.
  fade: {
    height: FOOTER_FADE,
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
  },
  resultFooter: {
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.two + Spacing.half,
    left: 0,
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.three - Spacing.half,
    position: 'absolute',
    right: 0,
  },

  // --- 4
  filedBody: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four + Spacing.half,
  },
  checkDisc: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: CHECK_DISC,
    justifyContent: 'center',
    width: CHECK_DISC,
  },
  checkGlyph: { ...Type.display, fontSize: 44, lineHeight: 50 },
  filedTitle: { ...Type.display, color: OnAccent.text, marginTop: Spacing.four, textAlign: 'center' },
  filedBlurb: {
    ...Type.body,
    color: OnAccent.textDim,
    marginTop: Spacing.two,
    textAlign: 'center',
  },

  ledgerWrap: { gap: Spacing.two, marginHorizontal: Spacing.four + Spacing.half, marginTop: Spacing.five },
  ledger: {
    backgroundColor: OnAccent.fill,
    borderRadius: Radius.xl,
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  ledgerRule: { backgroundColor: OnAccent.rule, width: 1 },
  ledgerCell: { flex: 1, gap: Spacing.one + Spacing.half },
  ledgerLabel: { ...Type.micro, color: OnAccent.labelDim, letterSpacing: 1.4 },
  ledgerFigure: { ...Type.numeralLarge, fontSize: 24, lineHeight: 29 },
  ledgerSource: { ...Type.caption, color: OnAccent.caption, fontSize: 10, lineHeight: 14 },
  ledgerNote: { ...Type.caption, color: OnAccent.caption, fontSize: 10, lineHeight: 14 },

  filedFooter: {
    bottom: 0,
    gap: Spacing.two + Spacing.half,
    left: 0,
    paddingHorizontal: Spacing.four + Spacing.half,
    position: 'absolute',
    right: 0,
  },

  // --- 8
  browseContent: {
    alignSelf: 'center',
    gap: Spacing.three - Spacing.one,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.gutter,
    width: '100%',
  },
  browseHead: { gap: Spacing.three - Spacing.one, paddingTop: Spacing.three },
  search: { borderRadius: Radius.md, paddingHorizontal: 15, paddingVertical: 13 - Spacing.half },
  searchInput: { ...Type.body, lineHeight: 18, minHeight: HitTarget - Spacing.four },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two - Spacing.half },
  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - Spacing.one + Spacing.half,
    paddingVertical: Spacing.two - Spacing.half,
  },
  chipText: { ...Type.bodyStrong, fontSize: 11, lineHeight: 14 },

  gridRow: { gap: Spacing.three - Spacing.one },
  // `maxWidth` so an odd last row leaves a gap rather than stretching one card wide.
  gridCell: { flex: 1, maxWidth: '50%' },
  gridCard: { gap: Spacing.one, padding: Spacing.two + Spacing.half },
  gridTile: { aspectRatio: EVIDENCE_ASPECT, borderRadius: Radius.xs + 2, width: '100%' },
  gridName: { ...Type.bodyStrong, marginTop: Spacing.one },
  gridModel: { ...Type.caption, fontSize: 11, lineHeight: 15 },
  emptyNote: { ...Type.callout, paddingVertical: Spacing.three },

  catalogGrowth: { gap: Spacing.three, marginTop: Spacing.three },
  unknownCard: { gap: Spacing.two, padding: Spacing.three },
  unknownInput: {
    ...Type.body,
    borderRadius: Radius.sm,
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },

  combinationContent: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.three,
    width: '100%',
  },
  combinationIntro: { gap: Spacing.two, padding: Spacing.three },
  combinationSummary: { gap: Spacing.three, padding: Spacing.three },
  combinationChoices: { gap: Spacing.two },
  combinationChoice: {
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },

  browseDetailContent: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.three,
    width: '100%',
  },
  browseDetailCard: { gap: Spacing.three, padding: Spacing.three },
  browseDetailSection: { gap: Spacing.one },
  browseDetailTitle: { ...Type.title },
  browseDetailCaption: { ...Type.callout },
  browseDetailFacts: { gap: Spacing.three },
  browseDetailFact: { ...Type.bodyStrong },
  browseDetailBody: { ...Type.body },
  browseDetailTile: { aspectRatio: EVIDENCE_ASPECT, width: '100%' },
  browseDetailSource: { ...Type.caption },

  // --- 9
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    bottom: 0,
    left: 0,
    paddingHorizontal: Spacing.four - Spacing.half,
    paddingTop: Spacing.four,
    position: 'absolute',
    right: 0,
  },
  grabHandle: {
    alignSelf: 'center',
    borderRadius: Radius.pill,
    height: GRAB_HANDLE_HEIGHT,
    marginBottom: Spacing.gutter,
    width: GRAB_HANDLE_WIDTH,
  },
  sheetHead: { alignItems: 'center', flexDirection: 'row', gap: Spacing.three - Spacing.two },
  sheetTile: { height: SHEET_TILE, width: SHEET_TILE },
  sheetTitle: { ...Type.title, fontSize: 24, letterSpacing: -0.4, lineHeight: 27 },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.two + Spacing.half,
    marginTop: Spacing.four - Spacing.half,
  },
});

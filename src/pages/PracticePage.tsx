import { useMemo, useState } from 'react';
import { Dartboard } from '../components/Dartboard';
import { RouteCard, type RouteReasonView } from '../components/RouteCard';
import { ScoreInput } from '../components/ScoreInput';
import { StatusBar } from '../components/StatusBar';
import { VisitTrail } from '../components/VisitTrail';
import { MAX_CHECKOUT, MAX_SETUP_REMAINING } from '../domain/checkoutRules';
import { CURATED_CHECKOUT_EXPLANATIONS, CURATED_SETUP_EXPLANATIONS } from '../data/explanations';
import { rankCheckoutRoutes } from '../engine/ranking/checkoutRanking';
import { useVisit } from '../hooks/useVisit';
import { usePreferences } from '../hooks/usePreferences';
import './PracticePage.css';

export type PracticeMode = 'checkout' | 'setup';

export interface PracticePageProps {
  readonly mode: PracticeMode;
}

const INITIAL_REMAINING: Record<PracticeMode, number> = { checkout: 103, setup: 305 };
const PRESETS: Record<PracticeMode, readonly number[]> = {
  checkout: [170, 167, 164, 161, 160, 122, 103, 61, 46, 40],
  setup: [350, 340, 309, 305, 302, 275, 271, 269, 235, 231],
};

/** 初期表示するルート件数。「すべて表示」で追加候補を出す。 */
const INITIAL_ROUTE_COUNT = 5;
const EXPANDED_ROUTE_COUNT = 40;

export function PracticePage({ mode }: PracticePageProps) {
  const { preferences } = usePreferences();
  const [showAll, setShowAll] = useState(false);
  const [focusedDartId, setFocusedDartId] = useState<string | null>(null);

  const suggestOptions = useMemo(
    () => ({ mainTarget: preferences.setupMainTarget }),
    [preferences.setupMainTarget],
  );

  const { visit, suggestion, throwDart, undo, nextVisit, reset } = useVisit(
    INITIAL_REMAINING[mode],
    suggestOptions,
  );

  /** MY ROUTE は得意ダブルを優先し、基準ルート加点を外して並べ替える。 */
  const myRoute = useMemo(() => {
    if (suggestion.mode !== 'checkout' || preferences.preferredDoubles.length === 0) return null;
    const ranked = rankCheckoutRoutes(visit.remaining, visit.dartsLeft, {
      preferredDoubles: preferences.preferredDoubles,
      applyStandardBonus: false,
    });
    return ranked.length > 0 ? ranked[0] : null;
  }, [suggestion.mode, visit.remaining, visit.dartsLeft, preferences.preferredDoubles]);

  const checkoutRoutes = suggestion.checkoutRoutes;
  const setupRoutes = suggestion.setupRoutes;
  const standardRoute = checkoutRoutes.find((route) => route.isStandard) ?? checkoutRoutes[0] ?? null;

  // STANDARD / MY ROUTE として別枠で出したものは OTHER ROUTES から除く。
  const shownKeys = new Set(
    [standardRoute?.key, myRoute?.key].filter((key): key is string => typeof key === 'string'),
  );
  const otherCheckout = checkoutRoutes.filter((route) => !shownKeys.has(route.key));
  const visibleCheckout = showAll
    ? otherCheckout.slice(0, EXPANDED_ROUTE_COUNT)
    : otherCheckout.slice(0, INITIAL_ROUTE_COUNT);
  const visibleSetup = showAll
    ? setupRoutes.slice(0, EXPANDED_ROUTE_COUNT)
    : setupRoutes.slice(0, INITIAL_ROUTE_COUNT);

  const highlightedDartIds = useMemo(() => {
    if (suggestion.mode === 'setup') return setupRoutes[0]?.darts.map((d) => d.id) ?? [];
    return standardRoute?.darts.map((d) => d.id) ?? [];
  }, [suggestion.mode, setupRoutes, standardRoute]);

  const statusNote = (() => {
    if (visit.status === 'bust') {
      return `Bust です。このビジットの得点は無効になり、${visit.visitStartRemaining} へ戻ります。`;
    }
    if (visit.status === 'checkout') return 'チェックアウト成立です。';
    if (suggestion.unavailableReason) return suggestion.unavailableReason;
    if (suggestion.tonTrapLeave !== null) {
      return `ちょうど 100 点を取ると ${suggestion.tonTrapLeave} 残りとなり、ノーテンになります。95〜105 点前後へずらしましょう。`;
    }
    return null;
  })();

  const toReasonViews = (
    reasons: readonly { code: string; polarity: RouteReasonView['polarity']; label: string; summary: string; detail: string | null }[],
  ): RouteReasonView[] => reasons.map((reason) => ({ ...reason }));

  return (
    <div className="practice">
      <section className="practice__controls" aria-label="残り点の設定">
        <ScoreInput
          label={mode === 'checkout' ? 'LEFT (2〜170)' : 'LEFT (171〜350)'}
          min={mode === 'checkout' ? 2 : 171}
          max={mode === 'checkout' ? MAX_CHECKOUT : MAX_SETUP_REMAINING}
          value={visit.visitStartRemaining}
          onCommit={(value) => {
            setShowAll(false);
            setFocusedDartId(null);
            reset(value);
          }}
          presets={PRESETS[mode]}
        />
      </section>

      <StatusBar
        remaining={visit.remaining}
        dartsLeft={visit.dartsLeft}
        status={visit.status}
        note={statusNote}
        tone={visit.status === 'bust' || suggestion.isBogey ? 'warn' : visit.status === 'checkout' ? 'good' : 'default'}
      />

      <section className="practice__board" aria-label="実戦入力">
        <p className="practice__hint">
          実際に刺さった場所をタップすると、残り点と残り本数から候補を再計算します。
        </p>
        <Dartboard
          onSelect={(segment) => throwDart(segment.dart)}
          highlightedDartIds={highlightedDartIds}
          focusDartId={focusedDartId}
          disabled={visit.status !== 'in-progress' || visit.dartsLeft === 0}
          disabledReason={
            visit.status === 'bust'
              ? 'Bust しました。「次のビジットへ」を押してください。'
              : visit.status === 'checkout'
                ? '上がりました。'
                : '3 投を使い切りました。'
          }
          ariaLabel="ダーツボード。実際に刺さった区画を選んでください。"
        />
        <VisitTrail
          visit={visit}
          onUndo={undo}
          onNextVisit={nextVisit}
          onReset={() => reset(visit.visitStartRemaining)}
        />
      </section>

      {suggestion.mode === 'checkout' && standardRoute && (
        <section className="practice__routes" aria-label="推奨ルート">
          <h2 className="practice__heading">STANDARD</h2>
          <RouteCard
            testId="standard-route"
            badge="STANDARD"
            isStandard={standardRoute.isStandard}
            grade={standardRoute.grade}
            dartIds={standardRoute.darts.map((dart) => dart.id)}
            reasons={toReasonViews(standardRoute.reasons)}
            curatedExplanation={CURATED_CHECKOUT_EXPLANATIONS[visit.remaining] ?? null}
            onDartFocus={setFocusedDartId}
            focusedDartId={focusedDartId}
            defaultOpen
          />

          {myRoute && myRoute.key !== standardRoute.key && (
            <>
              <h2 className="practice__heading">MY ROUTE</h2>
              <RouteCard
                testId="my-route"
                badge="MY ROUTE"
                grade={myRoute.grade}
                dartIds={myRoute.darts.map((dart) => dart.id)}
                reasons={toReasonViews(myRoute.reasons)}
                onDartFocus={setFocusedDartId}
                focusedDartId={focusedDartId}
              />
            </>
          )}

          <h2 className="practice__heading">OTHER ROUTES</h2>
          <div className="practice__list">
            {visibleCheckout.map((route) => (
              <RouteCard
                key={route.key}
                testId={`route-${route.key}`}
                grade={route.grade}
                dartIds={route.darts.map((dart) => dart.id)}
                reasons={toReasonViews(route.reasons)}
                onDartFocus={setFocusedDartId}
                focusedDartId={focusedDartId}
              />
            ))}
          </div>
          {checkoutRoutes.length > INITIAL_ROUTE_COUNT && (
            <button
              type="button"
              className="practice__more"
              data-testid="show-all-routes"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? '上位候補だけ表示'
                : `すべて表示（合法な候補 ${checkoutRoutes.length} 件）`}
            </button>
          )}
        </section>
      )}

      {suggestion.mode === 'setup' && setupRoutes.length > 0 && (
        <section className="practice__routes" aria-label="推奨セットアップ">
          <h2 className="practice__heading">SETUP — 次ラウンドの残しを作る</h2>
          <div className="practice__list">
            {visibleSetup.map((route, index) => (
              <RouteCard
                key={route.key}
                testId={index === 0 ? 'standard-route' : `setup-${route.key}`}
                badge={index === 0 ? 'BEST' : undefined}
                grade={route.grade}
                dartIds={route.darts.map((dart) => dart.id)}
                meta={`取得 ${route.scored} 点 → 残り ${route.leave}`}
                reasons={toReasonViews(route.reasons)}
                curatedExplanation={
                  index === 0 ? (CURATED_SETUP_EXPLANATIONS[visit.remaining] ?? null) : null
                }
                onDartFocus={setFocusedDartId}
                focusedDartId={focusedDartId}
                defaultOpen={index === 0}
              />
            ))}
          </div>
          {setupRoutes.length > INITIAL_ROUTE_COUNT && (
            <button
              type="button"
              className="practice__more"
              data-testid="show-all-routes"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? '上位候補だけ表示' : `すべて表示（候補 ${setupRoutes.length} 件）`}
            </button>
          )}
        </section>
      )}

      {suggestion.mode === 'checkout' && checkoutRoutes.length === 0 && (
        <p className="practice__empty" data-testid="no-routes">
          {suggestion.unavailableReason ?? 'この残りで成立するルートはありません。'}
        </p>
      )}
    </div>
  );
}

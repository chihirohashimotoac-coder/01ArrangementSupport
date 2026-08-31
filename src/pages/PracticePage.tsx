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

const RANGE: Record<PracticeMode, { readonly min: number; readonly max: number }> = {
  checkout: { min: 2, max: MAX_CHECKOUT },
  setup: { min: 171, max: MAX_SETUP_REMAINING },
};
const PRESETS: Record<PracticeMode, readonly number[]> = {
  checkout: [170, 167, 164, 161, 160, 122, 103, 61, 46, 40],
  setup: [350, 340, 309, 305, 302, 275, 271, 269, 235, 231],
};

/** 初期表示するルート件数。 */
const INITIAL_ROUTE_COUNT = 5;
/** 「さらに表示」1 回あたりの追加件数。 */
const ROUTE_PAGE_SIZE = 40;

interface RouteListControlsProps {
  readonly total: number;
  readonly visibleCount: number;
  readonly allLabel: (total: number) => string;
  readonly onChange: (visibleCount: number) => void;
}

/**
 * 候補リストの表示件数を操作するボタン。
 *
 * CHECKOUT は合法な候補が 1400 件を超えることがあり、実測でも一度に描画すると
 * モバイルで 1.5 秒ほど固まる。そのため既定では段階的に増やし、
 * 「すべて表示」を選んだときだけ全件を描画する。
 * どちらのラベルも、実際に表示される件数と必ず一致させる。
 */
function RouteListControls({ total, visibleCount, allLabel, onChange }: RouteListControlsProps) {
  const rest = total - Math.min(visibleCount, total);

  if (rest === 0) {
    if (total <= INITIAL_ROUTE_COUNT) return null;
    return (
      <button
        type="button"
        className="practice__more"
        data-testid="show-all-routes"
        onClick={() => onChange(INITIAL_ROUTE_COUNT)}
      >
        上位 {INITIAL_ROUTE_COUNT} 件だけ表示
      </button>
    );
  }

  return (
    <div className="practice__more-group">
      {rest > ROUTE_PAGE_SIZE && (
        <button
          type="button"
          className="practice__more"
          data-testid="show-more-routes"
          onClick={() => onChange(visibleCount + ROUTE_PAGE_SIZE)}
        >
          さらに {ROUTE_PAGE_SIZE} 件表示（残り {rest} 件）
        </button>
      )}
      <button
        type="button"
        className="practice__more"
        data-testid="show-all-routes"
        onClick={() => onChange(total)}
      >
        {allLabel(total)}
      </button>
    </div>
  );
}

export function PracticePage({ mode }: PracticePageProps) {
  const { preferences } = usePreferences();
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROUTE_COUNT);
  const [focusedDartId, setFocusedDartId] = useState<string | null>(null);

  const suggestOptions = useMemo(
    () => ({ mainTarget: preferences.setupMainTarget }),
    [preferences.setupMainTarget],
  );

  /*
   * 残り点は未入力（null）から始める。入力する前に 103 / 305 のような
   * 既定値の候補を出してしまうと、実戦では読み違えのもとになる。
   */
  const { visit, suggestion, throwDart, undo, nextVisit, reset, clear } = useVisit(
    null,
    suggestOptions,
  );

  /** MY ROUTE は得意ダブルを優先し、基準ルート加点を外して並べ替える。 */
  const myRoute = useMemo(() => {
    if (visit === null || suggestion?.mode !== 'checkout') return null;
    if (preferences.preferredDoubles.length === 0) return null;
    const ranked = rankCheckoutRoutes(visit.remaining, visit.dartsLeft, {
      preferredDoubles: preferences.preferredDoubles,
      applyStandardBonus: false,
    });
    return ranked.length > 0 ? ranked[0] : null;
  }, [visit, suggestion?.mode, preferences.preferredDoubles]);

  const checkoutRoutes = suggestion?.checkoutRoutes ?? [];
  const setupRoutes = suggestion?.setupRoutes ?? [];
  const standardRoute = checkoutRoutes.find((route) => route.isStandard) ?? checkoutRoutes[0] ?? null;

  // STANDARD / MY ROUTE として別枠で出したものは OTHER ROUTES から除く。
  const shownKeys = new Set(
    [standardRoute?.key, myRoute?.key].filter((key): key is string => typeof key === 'string'),
  );
  const otherCheckout = checkoutRoutes.filter((route) => !shownKeys.has(route.key));

  /*
   * 「すべて表示」は文字どおり全件を出す。以前は 40 件で黙って打ち切りつつ
   * 合法な候補の総数を見出しに出していたため、件数と表示が食い違っていた。
   */
  const visibleCheckout = otherCheckout.slice(0, visibleCount);
  const visibleSetup = setupRoutes.slice(0, visibleCount);

  const highlightedDartIds = useMemo(() => {
    if (suggestion === null) return [];
    if (suggestion.mode === 'setup') return suggestion.setupRoutes[0]?.darts.map((d) => d.id) ?? [];
    return standardRoute?.darts.map((d) => d.id) ?? [];
  }, [suggestion, standardRoute]);

  const statusNote = (() => {
    if (visit === null || suggestion === null) return null;
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

  const range = RANGE[mode];

  return (
    <div className="practice">
      <section className="practice__controls" aria-label="残り点の設定">
        <ScoreInput
          label="LEFT"
          min={range.min}
          max={range.max}
          value={visit?.visitStartRemaining ?? null}
          onChange={(value) => {
            setVisibleCount(INITIAL_ROUTE_COUNT);
            setFocusedDartId(null);
            if (value === null) clear();
            else reset(value);
          }}
          presets={PRESETS[mode]}
        />
      </section>

      {visit === null || suggestion === null ? (
        <p className="practice__idle" data-testid="practice-idle">
          残り点（LEFT）を入力すると、候補と理由をここに表示します。
        </p>
      ) : (
        <>
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

              {otherCheckout.length > 0 && (
                <>
                  <h2 className="practice__heading">OTHER ROUTES</h2>
                  <div className="practice__list" data-testid="other-routes">
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
                </>
              )}
              <RouteListControls
                total={otherCheckout.length}
                visibleCount={visibleCount}
                allLabel={(total) => `すべて表示（他の候補 ${total} 件）`}
                onChange={setVisibleCount}
              />
            </section>
          )}

          {suggestion.mode === 'setup' && setupRoutes.length > 0 && (
            <section className="practice__routes" aria-label="推奨セットアップ">
              <h2 className="practice__heading">SETUP — 次ラウンドの残しを作る</h2>
              <div className="practice__list" data-testid="setup-routes">
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
              <RouteListControls
                total={setupRoutes.length}
                visibleCount={visibleCount}
                allLabel={(total) => `すべて表示（候補 ${total} 件）`}
                onChange={setVisibleCount}
              />
            </section>
          )}

          {suggestion.mode === 'checkout' && checkoutRoutes.length === 0 && (
            <p className="practice__empty" data-testid="no-routes">
              {suggestion.unavailableReason ?? 'この残りで成立するルートはありません。'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

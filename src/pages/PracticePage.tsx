import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dartboard } from '../components/Dartboard';
import { NextTarget } from '../components/NextTarget';
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

interface ModeCopy {
  readonly min: number;
  readonly max: number;
  /** LEFT ラベルに添える短い補足。モバイルで折り返しても読める長さにする。 */
  readonly hint: string;
  /** 未入力時の入力例。 */
  readonly placeholder: string;
}

const COPY: Record<PracticeMode, ModeCopy> = {
  checkout: {
    min: 2,
    max: MAX_CHECKOUT,
    hint: `2〜${MAX_CHECKOUT}・この3投で上がる`,
    placeholder: '例 103',
  },
  setup: {
    min: 171,
    max: MAX_SETUP_REMAINING,
    hint: `171〜${MAX_SETUP_REMAINING}・次の3投に向けて整える`,
    placeholder: '例 302',
  },
};

/** 初期表示するルート件数。 */
const INITIAL_ROUTE_COUNT = 5;
/** 「さらに表示」1 回あたりの追加件数。 */
const ROUTE_PAGE_SIZE = 40;

/**
 * 入力完了から結果へ移動するまでの待ち時間。
 *
 * iOS では Done / Enter で keyboard が閉じるときに visual viewport が動く。
 * 閉じ切る前に scrollIntoView すると、keyboard の resize とスクロールが
 * 競合して行き先がずれるため、少しだけ待ってから動かす。
 */
const KEYBOARD_SETTLE_MS = 250;

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

export interface PracticePageProps {
  readonly mode: PracticeMode;
}

export function PracticePage({ mode }: PracticePageProps) {
  const { preferences } = usePreferences();
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROUTE_COUNT);
  const [focusedDartId, setFocusedDartId] = useState<string | null>(null);
  /*
   * 実戦入力（盤面）は通常時たたんでおく。
   * 「103 のアレンジを見たい」という普段の使い方では、答えより先に大きな盤面を
   * 通過させたくない。外したときだけ開く。
   */
  const [recoveryOpen, setRecoveryOpen] = useState(false);

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

  const resultRef = useRef<HTMLDivElement | null>(null);
  const recoveryRef = useRef<HTMLElement | null>(null);
  const scrollTimer = useRef<number | null>(null);
  /** 実戦入力を開いたあと、描画が済んでから盤面まで移動するか。 */
  const scrollToRecovery = useRef(false);

  useEffect(
    () => () => {
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  /**
   * 予約されている「答えへの移動」を取り消す。
   *
   * LEFT を書き換えたあとの blur でも入力完了として移動を予約するが、
   * その 250ms のあいだにユーザーが実戦入力を開いたりルートのチップを押したら、
   * ユーザー自身が選んだ行き先を優先する。iPhone では
   * 「LEFT 入力 → keyboard 表示中に『実際の着弾を入力』をタップ」で
   * blur → click の順に起きるため、click 側で必ず取り消す。
   */
  const cancelPendingScroll = useCallback(() => {
    if (scrollTimer.current === null) return;
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = null;
  }, []);

  const scrollBehavior = (): ScrollBehavior =>
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ? 'auto' : 'smooth';

  /**
   * 入力を終えた（Enter / Done）ときだけ、答えの位置へ移動する。
   *
   * 入力途中では絶対に動かさない。103 を打つ途中の "10" もそれ自体は合法な
   * CHECKOUT 値なので、有効値になっただけで動かすと入力中に画面が飛ぶ。
   * 移動先は StatusBar ではなく、実際の答えである STANDARD / BEST の先頭。
   */
  const handleCommit = useCallback(() => {
    cancelPendingScroll();
    scrollTimer.current = window.setTimeout(() => {
      scrollTimer.current = null;
      resultRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }, KEYBOARD_SETTLE_MS);
  }, [cancelPendingScroll]);

  /*
   * ルートのチップから実戦入力を開いたときだけ、盤面が見える位置まで移動する。
   * 開いた直後は DOM がまだ無いので、描画が終わる effect まで待つ。
   * すでに開いている（盤面が見えている）ときは動かさない。
   */
  useEffect(() => {
    if (!recoveryOpen || !scrollToRecovery.current) return;
    scrollToRecovery.current = false;
    recoveryRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, [recoveryOpen]);

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
  /*
   * CHECKOUT 中に上がれなくなったときだけ入る「次ラウンドへの残し」。
   * CHECKOUT ルートがある状態では engine 側で必ず null になる。
   */
  const nextVisitRoute = suggestion?.nextVisitRoute ?? null;
  const standardRoute = checkoutRoutes.find((route) => route.isStandard) ?? checkoutRoutes[0] ?? null;
  const bestSetup = setupRoutes[0] ?? null;

  // STANDARD / MY ROUTE として別枠で出したものは OTHER ROUTES から除く。
  const shownKeys = new Set(
    [standardRoute?.key, myRoute?.key].filter((key): key is string => typeof key === 'string'),
  );
  const otherCheckout = checkoutRoutes.filter((route) => !shownKeys.has(route.key));
  // SETUP も BEST を別枠に出すので、その他候補は 2 件目以降。
  const otherSetup = setupRoutes.slice(1);

  /*
   * 「すべて表示」は文字どおり全件を出す。以前は 40 件で黙って打ち切りつつ
   * 合法な候補の総数を見出しに出していたため、件数と表示が食い違っていた。
   */
  const visibleCheckout = otherCheckout.slice(0, visibleCount);
  const visibleSetup = otherSetup.slice(0, visibleCount);

  const nextDartIds = useMemo(() => {
    if (suggestion === null) return null;
    if (suggestion.mode === 'setup') return bestSetup?.darts.map((dart) => dart.id) ?? null;
    if (standardRoute) return standardRoute.darts.map((dart) => dart.id);
    // CHECKOUT ルートが無いときだけ、次ラウンドへの残しを盤面へ出す。
    return nextVisitRoute?.darts.map((dart) => dart.id) ?? null;
  }, [suggestion, bestSetup, standardRoute, nextVisitRoute]);

  const highlightedDartIds = nextDartIds ?? [];

  /**
   * 候補が 1 件も無いときに、ルート一覧の代わりへ出す文言。
   * 状態のお知らせ（practice__note）と重複させないため、1 か所で決めておく。
   */
  const emptyNotice = (() => {
    if (suggestion === null) return null;
    if (suggestion.mode === 'checkout' && checkoutRoutes.length === 0) {
      return suggestion.unavailableReason ?? 'この残りで成立するルートはありません。';
    }
    if (suggestion.mode === 'setup' && setupRoutes.length === 0) {
      return suggestion.unavailableReason ?? 'この残りで作れるセットアップがありません。';
    }
    return null;
  })();

  const statusNote = (() => {
    if (visit === null || suggestion === null) return null;
    if (visit.status === 'bust') {
      return `Bust です。この3投の得点は無効になり、${visit.visitStartRemaining} へ戻ります。`;
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

  /**
   * ルートのチップを押したら、盤面でその位置を確認できるようにする。
   *
   * チップは MY ROUTE や OTHER ROUTES など盤面より下のカードにもあるので、
   * たたんだ状態から開いた場合は盤面まで移動しないと、開いた盤面が
   * viewport の上へ出てしまい「押したのに何も起きない」ように見える。
   */
  const focusDart = useCallback(
    (dartId: string) => {
      cancelPendingScroll();
      setFocusedDartId(dartId);
      setRecoveryOpen((open) => {
        if (!open) scrollToRecovery.current = true;
        return true;
      });
    },
    [cancelPendingScroll],
  );

  const copy = COPY[mode];

  /** STANDARD / BEST の直後に置く「実際の着弾を入力」とその展開部。 */
  const recoverySection = visit === null ? null : (
    <>
      <button
        type="button"
        className="practice__recovery-toggle"
        data-testid="recovery-toggle"
        aria-expanded={recoveryOpen}
        aria-controls="practice-recovery"
        onClick={() => {
          // ユーザー自身が行き先を決めたので、予約されている移動は捨てる。
          cancelPendingScroll();
          setRecoveryOpen((open) => !open);
        }}
      >
        <span className="practice__recovery-toggle-label">
          {recoveryOpen ? '実際の着弾の入力を閉じる' : '実際の着弾を入力'}
        </span>
        <span className="practice__recovery-toggle-sub">
          {recoveryOpen ? '通常の表示へ戻す' : '外したときは、ここから次の狙いを出す'}
        </span>
      </button>

      {recoveryOpen && (
        <section
          className="practice__board"
          id="practice-recovery"
          ref={recoveryRef}
          aria-label="実戦入力"
        >
          <StatusBar
            remaining={visit.remaining}
            dartsLeft={visit.dartsLeft}
            status={visit.status}
            note={statusNote}
            tone={
              visit.status === 'bust' || suggestion?.isBogey
                ? 'warn'
                : visit.status === 'checkout'
                  ? 'good'
                  : 'default'
            }
          />
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
                ? 'Bust しました。「次の3投へ」を押してください。'
                : visit.status === 'checkout'
                  ? '上がりました。'
                  : '3 投を使い切りました。'
            }
            ariaLabel="ダーツボード。実際に刺さった区画を選んでください。"
          />
          <NextTarget
            remaining={visit.remaining}
            dartsLeft={visit.dartsLeft}
            status={visit.status}
            hasThrown={visit.thrown.length > 0}
            dartIds={nextDartIds}
            onUndo={undo}
          />
          <VisitTrail
            visit={visit}
            onNextVisit={nextVisit}
            onReset={() => reset(visit.visitStartRemaining)}
          />
        </section>
      )}
    </>
  );

  return (
    <div className="practice">
      <section className="practice__controls" aria-label="残り点の設定">
        <ScoreInput
          label="残り点 LEFT"
          hint={copy.hint}
          placeholder={copy.placeholder}
          min={copy.min}
          max={copy.max}
          value={visit?.visitStartRemaining ?? null}
          onChange={(value) => {
            setVisibleCount(INITIAL_ROUTE_COUNT);
            setFocusedDartId(null);
            /*
             * 別の残り点へ書き換えたら、新しい3投として入力し直す。
             * 前の3投の着弾が残ったままだと、別の残り点の候補を読んでしまう。
             */
            setRecoveryOpen(false);
            if (value === null) clear();
            else reset(value);
          }}
          onCommit={handleCommit}
        />
      </section>

      {visit === null || suggestion === null ? (
        <>
          <p className="practice__idle" data-testid="practice-idle">
            残り点（LEFT）を入力すると、候補と理由をここに表示します。
          </p>
          {/*
            答えがまだ何も無い余白にだけ、MY ROUTE 設定の存在を静かに知らせる。
            表示専用で、設定・ランキング・保存のいずれにも触れない。
          */}
          {mode === 'checkout' && (
            <p className="practice__tip" data-testid="practice-tip">
              {/* 全角スペース区切り。JSX へ直接書くと lint の no-irregular-whitespace に触れる。 */}
              {'TIP\u3000得意なダブルは「設定」から登録できます。MY ROUTEの優先順位に反映されます。'}
            </p>
          )}
        </>
      ) : (
        <div className="practice__result" ref={resultRef}>
          {/*
            盤面をたたんでいるあいだも、ノーテンや TON の罠は先に伝える。
            ただし同じ文言をルート一覧の代わり（practice__empty）にも出す場合は、
            ここでは繰り返さない。同じ文を 2 度読ませると、その下にある答え
            （NEXT VISIT）が押し下げられるだけで、伝わる情報は増えない。
          */}
          {!recoveryOpen && statusNote && statusNote !== emptyNotice && (
            <p className="practice__note" data-testid="status-note">
              {statusNote}
            </p>
          )}

          {/* 1. 答え —— 残り点のすぐ下に、基準ルートと理由を置く。 */}
          {suggestion.mode === 'checkout' && standardRoute && (
            <section className="practice__routes" aria-label="推奨ルート">
              <h2 className="practice__heading">STANDARD — 基準ルート</h2>
              <RouteCard
                testId="standard-route"
                badge="STANDARD"
                isStandard={standardRoute.isStandard}
                grade={standardRoute.grade}
                dartIds={standardRoute.darts.map((dart) => dart.id)}
                reasons={toReasonViews(standardRoute.reasons)}
                curatedExplanation={CURATED_CHECKOUT_EXPLANATIONS[visit.remaining] ?? null}
                onDartFocus={focusDart}
                focusedDartId={focusedDartId}
                defaultOpen
              />
            </section>
          )}

          {suggestion.mode === 'setup' && bestSetup && (
            <section className="practice__routes" aria-label="推奨セットアップ">
              <h2 className="practice__heading">BEST — 次ラウンドの残しを作る</h2>
              <RouteCard
                testId="standard-route"
                badge="BEST"
                grade={bestSetup.grade}
                dartIds={bestSetup.darts.map((dart) => dart.id)}
                meta={`取得 ${bestSetup.scored} 点 → 残り ${bestSetup.leave}`}
                reasons={toReasonViews(bestSetup.reasons)}
                curatedExplanation={CURATED_SETUP_EXPLANATIONS[visit.remaining] ?? null}
                onDartFocus={focusDart}
                focusedDartId={focusedDartId}
                defaultOpen
              />
            </section>
          )}

          {emptyNotice && (
            <p className="practice__empty" data-testid="no-routes">
              {emptyNotice}
            </p>
          )}

          {/*
            1.5. 上がれないときの答え —— 盤面より前に置く。
            判断を増やさないよう最適候補 1 件だけを出し、理由の展開もしない。
          */}
          {suggestion.mode === 'checkout' && nextVisitRoute && (
            <section className="practice__routes" aria-label="次ラウンドへの残し">
              <h2 className="practice__heading">NEXT VISIT — 次ラウンドへ整える</h2>
              <RouteCard
                testId="next-visit-route"
                badge="NEXT VISIT"
                dartIds={nextVisitRoute.darts.map((dart) => dart.id)}
                meta={`取得 ${nextVisitRoute.scored} 点 → 残り ${nextVisitRoute.leave}`}
                reasons={[]}
                onDartFocus={focusDart}
                focusedDartId={focusedDartId}
              />
            </section>
          )}

          {/*
            2. 実戦入力 —— 答えの直後。
            提案が出ない状況（Bust・3 投使い切り）でも操作を続けられるよう、
            ルートの表示条件とは切り離してここへ置く。
          */}
          {recoverySection}

          {/* 3. その他の候補 —— 通常はここまでスクロールしない前提の位置。 */}
          {suggestion.mode === 'checkout' && standardRoute && (
            <section className="practice__routes" aria-label="その他のルート">
              {myRoute && myRoute.key !== standardRoute.key && (
                <>
                  <h2 className="practice__heading">MY ROUTE</h2>
                  <RouteCard
                    testId="my-route"
                    badge="MY ROUTE"
                    grade={myRoute.grade}
                    dartIds={myRoute.darts.map((dart) => dart.id)}
                    reasons={toReasonViews(myRoute.reasons)}
                    onDartFocus={focusDart}
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
                        onDartFocus={focusDart}
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

          {suggestion.mode === 'setup' && bestSetup && otherSetup.length > 0 && (
            <section className="practice__routes" aria-label="その他のセットアップ候補">
              <h2 className="practice__heading">OTHER ROUTES</h2>
              <div className="practice__list" data-testid="setup-routes">
                {visibleSetup.map((route) => (
                  <RouteCard
                    key={route.key}
                    testId={`setup-${route.key}`}
                    grade={route.grade}
                    dartIds={route.darts.map((dart) => dart.id)}
                    meta={`取得 ${route.scored} 点 → 残り ${route.leave}`}
                    reasons={toReasonViews(route.reasons)}
                    onDartFocus={focusDart}
                    focusedDartId={focusedDartId}
                  />
                ))}
              </div>
              <RouteListControls
                total={otherSetup.length}
                visibleCount={visibleCount}
                allLabel={(total) => `すべて表示（他の候補 ${total} 件）`}
                onChange={setVisibleCount}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

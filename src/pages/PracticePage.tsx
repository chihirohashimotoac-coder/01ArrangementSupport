import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AimAreaCard } from '../components/AimAreaCard';
import { Dartboard } from '../components/Dartboard';
import { GlossaryText } from '../components/GlossaryText';
import { NextTarget } from '../components/NextTarget';
import { RouteCard, type RouteReasonView } from '../components/RouteCard';
import { ScoreInput } from '../components/ScoreInput';
import { StatusBar } from '../components/StatusBar';
import { VisitTrail } from '../components/VisitTrail';
import { MAX_CHECKOUT, MAX_SETUP_REMAINING } from '../domain/checkoutRules';
import type { Dart } from '../domain/dart';
import {
  CURATED_CHECKOUT_EXPLANATIONS,
  CURATED_SETUP_EXPLANATIONS,
  CURATED_SETUP_LINE_EXAMPLES,
} from '../data/explanations';
import { otherRoutesGradeContext } from '../data/gradeLabels';
import { analyzeAimArea } from '../engine/aimArea/aimArea';
import { selectMyRoute } from '../engine/ranking/checkoutRanking';
import { practicalLastDartReasonViews } from '../engine/simulation/lastDartChoice';
import type { VisitState } from '../engine/recovery/visit';
import { followVisitPlan } from '../engine/recovery/visitPlan';
import { useVisit } from '../hooks/useVisit';
import { usePreferences } from '../hooks/usePreferences';
import { ENTRY_BAR_RESERVE_REM, entryScrollOffset } from './entryBarLayout';
import './PracticePage.css';

/** 帯のために確保する高さを CSS へ渡す（盤面の大きさの上限に使う）。 */
const ENTRY_BOARD_STYLE = { '--entry-bar-reserve': `${ENTRY_BAR_RESERVE_REM}rem` } as CSSProperties;

/**
 * 実戦入力を開いたとき、まとまりの先頭から「さらに下へずらす量」を実測から求める。
 * 盤面は帯の直前の要素（Dartboard の外枠）。
 */
function measureEntryScrollOffset(section: HTMLElement, bar: HTMLElement | null): number {
  const board = bar?.previousElementSibling;
  if (!bar || !board) return 0;
  const px = (value: string) => Number.parseFloat(value) || 0;
  const rootFontSize = px(getComputedStyle(document.documentElement).fontSize) || 16;
  const sectionRect = section.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  return entryScrollOffset({
    sectionTop: sectionRect.top,
    boardTop: boardRect.top,
    boardBottom: boardRect.bottom,
    gap: px(getComputedStyle(section).rowGap),
    barHeight: bar.offsetHeight,
    // iPhone のホームバーのぶん（帯の下の余白）も足す。
    reserve: ENTRY_BAR_RESERVE_REM * rootFontSize + px(getComputedStyle(bar).paddingBottom),
    viewportHeight: window.innerHeight,
  });
}

export type PracticeMode = 'checkout' | 'setup';

/**
 * ユーザーが明示的に「このルートで投げる」と選んだルートの出どころ。
 *
 * STANDARD / BEST は何も選んでいないときの既定の答えなので、ここには含めない。
 */
type SelectedRouteSource = 'my' | 'other-checkout' | 'other-setup';

/**
 * 選んだルートの記録（このページ内だけの一時 UI state）。
 *
 * 保存しない（localStorage / preferences / URL などへは出さない）。
 * engine へも渡さないので、CHECKOUT / SETUP / NEXT VISIT の候補・順位・
 * 採点は、選んでいてもいなくてもまったく同じ結果になる。
 */
interface SelectedRoutePlan {
  readonly source: SelectedRouteSource;
  /** 選んだルート全体（Dart ID）。どのチップを押しても先頭から追従する。 */
  readonly dartIds: readonly string[];
  /** 選んだ時点で投げ終えていた本数。ここから先の着弾だけを照合する。 */
  readonly thrownAtSelection: number;
  /** 選んだ時点のビジット開始残り。別ビジットへ選択を持ち越さないための番人。 */
  readonly visitStartRemaining: number;
}

/** いまの visit から見た、選んだルートの状態。 */
interface SelectedRouteState {
  readonly source: SelectedRouteSource;
  /** 予定どおり進んでいるときの残りのダーツ。1 投でも外したら null。 */
  readonly remainingDartIds: readonly string[] | null;
}

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

/** 計画の続き（A-32）と食い違うとき、再計算の答えに付ける見出しと札。 */
const ALTERNATIVE_HEADING = '別例（推奨ではありません）';
const ALTERNATIVE_BADGE = '別例';

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

/**
 * 選んだルートが、いまも「予定どおり」かを現在の visit から判定する。
 *
 * 判定は Dart ID の完全一致だけで行う。T20 を狙って S20 / D20 に入ったら
 * 同じ 20 でも「外した」として扱う（得点が違うので当然）。
 *
 * 毎回この関数で導くので、Bust・上がり・3 投使い切り・別ビジット・Undo の
 * あとに古い選択が生き残ることがない。
 */
function followSelectedRoute(
  plan: SelectedRoutePlan | null,
  visit: VisitState | null,
): SelectedRouteState | null {
  if (plan === null || visit === null) return null;
  // Bust / 上がり / 3 投使い切りでは、選んだルートは終了する。
  if (visit.status !== 'in-progress' || visit.dartsLeft <= 0) return null;
  // LEFT 変更・reset・次の3投で別ビジットになったら持ち越さない。
  if (visit.visitStartRemaining !== plan.visitStartRemaining) return null;

  const thrownSince = visit.thrown.length - plan.thrownAtSelection;
  // Undo で選んだ時点より前へ戻った / ルートを投げ切った場合は使わない。
  if (thrownSince < 0 || thrownSince >= plan.dartIds.length) return null;

  for (let index = 0; index < thrownSince; index += 1) {
    const actual = visit.thrown[plan.thrownAtSelection + index];
    if (actual === undefined || actual.dart.id !== plan.dartIds[index]) {
      // 外した。選んだ出どころだけを残し、残りルートは無効にする。
      return { source: plan.source, remainingDartIds: null };
    }
  }
  return { source: plan.source, remainingDartIds: plan.dartIds.slice(thrownSince) };
}

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
  readonly onModeChange: (mode: PracticeMode) => void;
  /**
   * 最初から入れておく残り点（ホームの例題から開いたとき）。
   * 入力欄に打ち込んだのと同じ状態で始まるだけで、候補の計算には関与しない。
   */
  readonly initialRemaining?: number | null;
  /** パンくずリストへ、いまの状況（「残り 103」）を知らせる。表示専用。 */
  readonly onContextChange?: (label: string | null) => void;
  /**
   * 範囲外の残り点を、もう一方のモードで開く（250 を CHECKOUT に入れたら SETUP へ）。
   * モードごとに状態を持つ仕様はそのままで、その値を入れた状態で始め直す。
   */
  readonly onOpenOtherMode?: (mode: PracticeMode, remaining: number) => void;
}

export function PracticePage({
  mode,
  onModeChange,
  initialRemaining = null,
  onContextChange,
  onOpenOtherMode,
}: PracticePageProps) {
  const { preferences } = usePreferences();
  const [selectedDarts, setSelectedDarts] = useState<1 | 2 | 3>(3);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROUTE_COUNT);
  const [focusedDartId, setFocusedDartId] = useState<string | null>(null);
  /*
   * 実戦入力（盤面）は通常時たたんでおく。
   * 「103 のアレンジを見たい」という普段の使い方では、答えより先に大きな盤面を
   * 通過させたくない。外したときだけ開く。
   */
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  /*
   * ユーザーが MY ROUTE / OTHER ROUTES のチップを押して選んだルート。
   * 次に狙う表示（NEXT / 盤面のハイライト）だけに使う一時 state で、
   * 保存もしないし、候補の計算・順位づけにも一切関与しない。
   */
  const [selectedRoutePlan, setSelectedRoutePlan] = useState<SelectedRoutePlan | null>(null);

  /*
   * NEXT VISIT（CHECKOUT 不能時の残し）だけで得意ダブルを見る。
   * 既存の CHECKOUT ランキングが読む preferredDoubles とは別の名前で渡すので、
   * STANDARD / OTHER ROUTES の順位はこの設定では変わらない。
   */
  const suggestOptions = useMemo(
    () => ({
      mainTarget: preferences.setupMainTarget,
      fallbackPreferredDoubles: preferences.preferredDoubles,
    }),
    [preferences.setupMainTarget, preferences.preferredDoubles],
  );

  /*
   * 残り点は未入力（null）から始める。入力する前に 103 / 305 のような
   * 既定値の候補を出してしまうと、実戦では読み違えのもとになる。
   */
  const { visit, suggestion, throwDart, undo, nextVisit, reset, resetReference, clear } = useVisit(
    initialRemaining,
    suggestOptions,
  );

  const contextLabel =
    visit === null
      ? null
      : visit.status === 'bust' && !visit.visitStartKnown
        ? 'BUST'
        : `残り ${visit.remaining}`;
  useEffect(() => {
    onContextChange?.(contextLabel);
  }, [contextLabel, onContextChange]);
  useEffect(() => () => onContextChange?.(null), [onContextChange]);

  const resultRef = useRef<HTMLDivElement | null>(null);
  const scoreInputRef = useRef<HTMLInputElement | null>(null);
  const recoveryRef = useRef<HTMLElement | null>(null);
  const entryBarRef = useRef<HTMLDivElement | null>(null);
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
   *
   * 縦の短い画面では、先頭を上端へ合わせるだけだと画面下に固定した帯が盤面の下端に
   * かぶる。そのときは、盤面と（伸びたときの）帯が収まるところまで、さらに下へずらす
   * （entryBarLayout.ts）。収まる画面では、これまでどおり先頭へ合わせるだけ。
   */
  useEffect(() => {
    if (!recoveryOpen || !scrollToRecovery.current) return;
    scrollToRecovery.current = false;
    const section = recoveryRef.current;
    if (!section) return;
    const offset = measureEntryScrollOffset(section, entryBarRef.current);
    if (offset <= 0) {
      section.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      return;
    }
    window.scrollTo({
      top: window.scrollY + section.getBoundingClientRect().top + offset,
      behavior: scrollBehavior(),
    });
  }, [recoveryOpen]);

  const selectedRoute = useMemo(
    () => followSelectedRoute(selectedRoutePlan, visit),
    [selectedRoutePlan, visit],
  );

  /*
   * 狙いどおりに入っているあいだは、ラウンド開始時の推奨（計画）を続ける（A-32）。
   * ユーザーが自分でルートを選んでいるときは、その選択（上の selectedRoute）を優先する。
   * 計画と再計算が食い違うときだけ、計画の続きを推奨にして再計算の答えを「別例」として並べる。
   */
  const planFollow = useMemo(
    () => (selectedRoute !== null ? null : followVisitPlan(visit, suggestOptions, suggestion)),
    [selectedRoute, visit, suggestOptions, suggestion],
  );
  const planDiverges = planFollow !== null && planFollow.alternativeDartIds !== null;

  /**
   * MY ROUTE は得意ダブルを優先し、基準ルート加点を外して並べ替える。
   * 通常評価で C のルート・ダブル→ダブル・1 本を繋ぎに使うルートは最上位にしない（A-28）。
   */
  const myRoute = useMemo(() => {
    if (visit === null || suggestion?.mode !== 'checkout') return null;
    if (preferences.preferredDoubles.length === 0) return null;
    return selectMyRoute(visit.remaining, visit.dartsLeft, preferences.preferredDoubles);
  }, [visit, suggestion?.mode, preferences.preferredDoubles]);

  /*
   * 「盤面の狙い方」（42 / 46 / 48 / 39 / 43 だけ）。
   * 候補・順位の計算とは独立した読み取り専用の教材で、現在の残り点と本数から導く。
   */
  const aimArea = useMemo(() => {
    if (visit === null || visit.status !== 'in-progress') return null;
    if (suggestion?.mode !== 'checkout') return null;
    return analyzeAimArea(visit.remaining, visit.dartsLeft);
  }, [visit, suggestion?.mode]);

  const checkoutRoutes = suggestion?.checkoutRoutes ?? [];
  const setupRoutes = suggestion?.setupRoutes ?? [];
  /*
   * CHECKOUT 中に上がれなくなったときだけ入る「次ラウンドへの残し」。
   * CHECKOUT ルートがある状態では engine 側で必ず null になる。
   */
  const nextVisitRoute = suggestion?.nextVisitRoute ?? null;
  const practicalLastDart = suggestion?.practicalLastDart ?? null;
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

  /*
   * 次に狙うルート。
   *
   * ルートを選んでいないユーザーには、これまでどおり STANDARD / BEST
   * （CHECKOUT 不能なら NEXT VISIT）をそのまま出す。選んだ場合だけ、
   * 予定どおり入っているあいだその続きへ追従する。
   * どの分岐でも engine の出力そのものを使い、作り直しはしない。
   */
  const nextDartIds = useMemo(() => {
    if (suggestion === null || visit?.status !== 'in-progress') return null;
    // 計画どおりに入っているあいだは、計画の残り（再計算と同じならそのまま同じ並び）。
    if (planFollow !== null) return planFollow.remainingDartIds;

    if (suggestion.mode === 'setup') {
      if (selectedRoute?.source === 'other-setup' && selectedRoute.remainingDartIds !== null) {
        return selectedRoute.remainingDartIds;
      }
      // 選んでいない、または外した場合は現在の残りからの BEST へ戻る。
      return practicalLastDart === null
        ? bestSetup?.darts.map((dart) => dart.id) ?? null
        : [practicalLastDart.dartId];
    }

    /*
     * SETUP で選んだルートは、残りが 170 以下へ入って CHECKOUT の場面になった
     * 時点で役目を終える。そこからは CHECKOUT の答え（STANDARD）が正しい。
     */
    if (selectedRoute !== null && selectedRoute.source !== 'other-setup') {
      if (selectedRoute.remainingDartIds !== null) return selectedRoute.remainingDartIds;
      /*
       * 外した場合。MY ROUTE を選んだユーザーは MY ROUTE の考え方を続けるので、
       * 現在の残り・本数から既存の MY ROUTE 算出（上の myRoute）をそのまま使う。
       * OTHER ROUTE は恒久的な戦術設定ではないので、ここでは何もせず
       * 下の STANDARD へ自動で戻す。
       */
      if (selectedRoute.source === 'my' && myRoute !== null) {
        return myRoute.darts.map((dart) => dart.id);
      }
    }

    if (standardRoute) return standardRoute.darts.map((dart) => dart.id);
    // CHECKOUT ルートが無いときだけ、次ラウンドへの残しを盤面へ出す。
    return practicalLastDart === null
      ? nextVisitRoute?.darts.map((dart) => dart.id) ?? null
      : [practicalLastDart.dartId];
  }, [suggestion, visit?.status, planFollow, bestSetup, standardRoute, nextVisitRoute, practicalLastDart, selectedRoute, myRoute]);

  /** 計画の続きを、いまの候補一覧の中のルートとして引く（推奨度と理由を出すため）。 */
  const planRoute = (() => {
    if (!planDiverges || planFollow === null) return null;
    const key = planFollow.remainingDartIds.join('-');
    return (
      (suggestion?.mode === 'setup' ? setupRoutes : checkoutRoutes).find((route) => route.key === key) ??
      null
    );
  })();


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
      return visit.visitStartKnown
        ? `Bust です。この3投の得点は無効になり、${visit.visitStartRemaining} へ戻ります。`
        : 'BUST。ラウンド開始時の残りを入力してください。';
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

  /**
   * MY ROUTE / OTHER ROUTES のチップを押したとき。
   *
   * 「盤面で位置を見る」という既存の動きはそのままに、そのルートを
   * 実戦入力の基準として選んだものとして扱う。追加の操作は求めない。
   * どのチップを押しても、ルートは先頭から追従する。
   */
  const selectRoute = useCallback(
    (dartId: string, source: SelectedRouteSource, dartIds: readonly string[]) => {
      focusDart(dartId);
      setSelectedRoutePlan(
        visit === null
          ? null
          : {
              source,
              dartIds: [...dartIds],
              // すでに何投か入力したあとでも、そこから追従を始められる。
              thrownAtSelection: visit.thrown.length,
              visitStartRemaining: visit.visitStartRemaining,
            },
      );
    },
    [focusDart, visit],
  );

  /**
   * STANDARD / BEST / NEXT VISIT のチップを押したとき。
   *
   * これらは何も選んでいないときの既定の答えなので、押したら選択を解除して
   * 通常どおりの案内へ戻す。「戻す」ための専用ボタンは作らない。
   */
  const focusDefaultDart = useCallback(
    (dartId: string) => {
      focusDart(dartId);
      setSelectedRoutePlan(null);
    },
    [focusDart],
  );

  /**
   * 実際の着弾を 1 投記録する。
   *
   * ルートを選んでいるあいだだけ、押したチップの focus を外す。
   * 選んだ時点の狙い（例 T19）が、着弾後の新しい NEXT より強く見えると
   * 盤面が読み違えのもとになる。選んでいないときの動きは変えない。
   */
  const handleThrow = useCallback(
    (dart: Dart) => {
      if (selectedRoutePlan !== null) setFocusedDartId(null);
      throwDart(dart);
    },
    [selectedRoutePlan, throwDart],
  );

  /** Undo。古い残りルートを表示しないよう、選択は必ず解除する。 */
  const handleUndo = useCallback(() => {
    setSelectedRoutePlan(null);
    undo();
  }, [undo]);

  const copy = COPY[mode];
  /** 着弾を入力している最中か（上部の入力欄を「ラウンド開始」として控えめに見せる）。 */
  const entering = visit !== null && visit.status === 'in-progress' && visit.thrown.length > 0;
  /** 範囲外の値を、もう一方のモードへ案内する。BUST の開始点入力（2〜350）では使わない。 */
  const redirectOf = (value: number) => {
    if (onOpenOtherMode === undefined) return null;
    if (mode === 'checkout' && value > MAX_CHECKOUT && value <= MAX_SETUP_REMAINING) {
      return {
        message: `${value} は SETUP（171〜${MAX_SETUP_REMAINING}）で見られます。`,
        actionLabel: 'SETUP で見る',
        onSelect: () => onOpenOtherMode('setup', value),
      };
    }
    if (mode === 'setup' && value >= 2 && value <= MAX_CHECKOUT) {
      return {
        message: `${value} は CHECKOUT（2〜${MAX_CHECKOUT}）で見られます。`,
        actionLabel: 'CHECKOUT で見る',
        onSelect: () => onOpenOtherMode('checkout', value),
      };
    }
    return null;
  };
  /** 答えの近くから、上の入力欄へ戻る（残り点を変える）。 */
  const focusScoreInput = () => {
    cancelPendingScroll();
    const input = scoreInputRef.current;
    if (input === null) return;
    input.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    input.focus({ preventScroll: true });
  };
  const otherRoutesContext = otherRoutesGradeContext(mode, visit?.dartsLeft ?? 3);
  const restoringUnknownBust = visit?.status === 'bust' && !visit.visitStartKnown;
  const inputCopy: ModeCopy = restoringUnknownBust
    ? { min: 2, max: MAX_SETUP_REMAINING, hint: 'ラウンド開始時の残りを入力・2〜350', placeholder: '例 181' }
    : copy;

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
          setRecoveryOpen((open) => {
            // 開いたら盤面の先頭（いまの残り）へ移動する。閉じるときは動かさない。
            if (!open) scrollToRecovery.current = true;
            return !open;
          });
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
          style={ENTRY_BOARD_STYLE}
          aria-label="実戦入力"
        >
          <StatusBar
            remaining={visit.status === 'bust' && !visit.visitStartKnown ? null : visit.remaining}
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
            onSelect={(segment) => handleThrow(segment.dart)}
            highlightedDartIds={highlightedDartIds}
            focusDartId={focusedDartId}
            disabled={visit.status !== 'in-progress' || visit.dartsLeft === 0}
            disabledReason={
              visit.status === 'bust'
                ? visit.visitStartKnown
                  ? 'Bust しました。「次の3投へ」を押してください。'
                  : 'BUST。ラウンド開始時の残りを入力してください。'
                : visit.status === 'checkout'
                  ? '上がりました。'
                  : '3 投を使い切りました。'
            }
            ariaLabel="ダーツボード。実際に刺さった区画を選んでください。"
          />
          {/*
            いまの残り・本数・次の狙い・「1投戻す」は、親指の届く画面下に固定する（2026-11-01 監査）。
            盤面を見ながら、次に狙う的と訂正の操作を探さずに済むように。
          */}
          <div className="practice__entry-bar" data-testid="entry-bar" ref={entryBarRef}>
          <NextTarget
            remaining={visit.status === 'bust' && !visit.visitStartKnown ? null : visit.remaining}
            dartsLeft={visit.dartsLeft}
            status={visit.status}
            hasThrown={visit.thrown.length > 0}
            bustStartUnknown={visit.status === 'bust' && !visit.visitStartKnown}
            dartIds={nextDartIds}
            nextVisitProposals={practicalLastDart || planDiverges ? [] : suggestion?.nextVisitProposals ?? []}
            onUndo={handleUndo}
          />
          </div>
          <VisitTrail
            visit={visit}
            onNextVisit={() => {
              // 前のビジットのルートを次のビジットへ持ち越さない。
              setSelectedRoutePlan(null);
              setSelectedDarts(3);
              nextVisit();
            }}
            onReset={() => {
              setSelectedRoutePlan(null);
              resetReference(visit.visitStartRemaining, visit.initialDartsLeft as 1 | 2 | 3);
            }}
          />
        </section>
      )}
    </>
  );

  return (
    <div className="practice">
      {/* 見出し構造（2026-11-01 監査 4-8）。見た目はナビ・パンくずが担うので隠す。 */}
      <h1 className="visually-hidden">
        {mode === 'checkout' ? 'CHECKOUT（残り 2〜170）' : 'SETUP（残り 171〜350）'}
      </h1>
      <section className="practice__controls" aria-label="残り点の設定">
        <ScoreInput
          label={entering ? 'ラウンド開始' : '残り点 LEFT'}
          hint={
            entering && visit !== null
              ? `いまの残り ${visit.remaining}・${visit.dartsLeft} 本`
              : // SETUP で「次の3投へ」を押して 170 以下になったら、CHECKOUT 側の補足に合わせる（監査フェーズ 2 / 2-9）。
                mode === 'setup' && suggestion?.mode === 'checkout' && !restoringUnknownBust
                ? COPY.checkout.hint
                : inputCopy.hint
          }
          compact={entering}
          inputRef={scoreInputRef}
          redirect={restoringUnknownBust ? undefined : redirectOf}
          placeholder={inputCopy.placeholder}
          min={inputCopy.min}
          max={inputCopy.max}
          commitOnly={restoringUnknownBust}
          value={visit?.status === 'bust' && !visit.visitStartKnown ? null : visit?.visitStartRemaining ?? null}
          onChange={(value) => {
            setSelectedDarts(3);
            setVisibleCount(INITIAL_ROUTE_COUNT);
            setFocusedDartId(null);
            // 別の残り点は別の場面。前の残り点で選んだルートは捨てる。
            setSelectedRoutePlan(null);
            /*
             * 別の残り点へ書き換えたら、新しい3投として入力し直す。
             * 前の3投の着弾が残ったままだと、別の残り点の候補を読んでしまう。
             */
            setRecoveryOpen(false);
            if (value === null) clear();
            else reset(value);
          }}
          onCommit={(value) => {
            if (restoringUnknownBust) {
              setSelectedDarts(3);
              setSelectedRoutePlan(null);
              setFocusedDartId(null);
              setVisibleCount(INITIAL_ROUTE_COUNT);
              setRecoveryOpen(false);
              reset(value);
              if ((value <= MAX_CHECKOUT ? 'checkout' : 'setup') !== mode) {
                onModeChange(value <= MAX_CHECKOUT ? 'checkout' : 'setup');
              }
            }
            handleCommit();
          }}
        />
        <fieldset className="practice__darts-choice" aria-label="残りダーツ数">
          <legend>残りダーツ</legend>
          <div className="practice__darts-buttons">
            {([1, 2, 3] as const).map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={selectedDarts === count}
                disabled={visit?.status === 'bust' && !visit.visitStartKnown}
                onClick={() => {
                  cancelPendingScroll();
                  setSelectedDarts(count);
                  setSelectedRoutePlan(null);
                  setFocusedDartId(null);
                  setVisibleCount(INITIAL_ROUTE_COUNT);
                  setRecoveryOpen(false);
                  if (visit !== null && !(visit.status === 'bust' && !visit.visitStartKnown)) {
                    resetReference(visit.remaining, count);
                  }
                }}
              >
                {count}本
              </button>
            ))}
          </div>
        </fieldset>
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
              <GlossaryText text={statusNote} />
            </p>
          )}

          {/*
            0. 計画の続き —— 狙いどおりに入っていて、再計算の答えが計画と違うときだけ出す（A-32）。
            推奨はこちら。下の基準ルート / BEST などは「別例」として並べる。
          */}
          {planFollow !== null && planDiverges && (
            <section className="practice__routes" aria-label="計画の続き">
              <h2 className="practice__heading" data-testid="plan-heading">
                計画の続き（推奨）
              </h2>
              <RouteCard
                testId="plan-route"
                badge="PLAN"
                grade={planRoute?.grade}
                dartIds={planFollow.remainingDartIds}
                meta={`ラウンド開始時の推奨 ${planFollow.planDartIds.join(' → ')} の続き`}
                reasons={planRoute === null ? [] : toReasonViews(planRoute.reasons)}
                onDartFocus={focusDefaultDart}
                focusedDartId={focusedDartId}
              />
            </section>
          )}

          {/* 1. 答え —— 残り点のすぐ下に、基準ルートと理由を置く。 */}
          {suggestion.mode === 'checkout' && standardRoute && (
            <section className="practice__routes" aria-label="推奨ルート">
              <div className="practice__heading-row">
                <h2 className="practice__heading" data-testid="standard-heading">
                  {planDiverges
                    ? `残り ${visit.remaining} からの${ALTERNATIVE_HEADING}`
                    : entering
                      ? `残り ${visit.remaining} の基準ルート`
                      : '基準ルート'}
                </h2>
                {recoveryOpen && (
                  <button
                    type="button"
                    className="practice__change-left"
                    data-testid="change-left"
                    onClick={focusScoreInput}
                  >
                    残り点を変える
                  </button>
                )}
              </div>
              <RouteCard
                testId="standard-route"
                badge={planDiverges ? ALTERNATIVE_BADGE : 'STANDARD'}
                isStandard={standardRoute.isStandard}
                grade={standardRoute.grade}
                dartIds={standardRoute.darts.map((dart) => dart.id)}
                reasons={toReasonViews(standardRoute.reasons)}
                curatedExplanation={CURATED_CHECKOUT_EXPLANATIONS[visit.remaining] ?? null}
                onDartFocus={focusDefaultDart}
                focusedDartId={focusedDartId}
                defaultOpen
              />
              {aimArea?.canFinishThisVisit && (
                <AimAreaCard
                  // 残り点・本数が変わったら別の場面なので、開閉は既定（閉）へ戻す。
                  key={`${aimArea.left}-${aimArea.dartsLeft}`}
                  analysis={aimArea}
                  preferredDoubles={preferences.preferredDoubles}
                />
              )}
            </section>
          )}

          {/* 上がれないことは、答え（実戦推奨・NEXT VISIT）より先に伝える。 */}
          {emptyNotice && (
            <p className="practice__empty" data-testid="no-routes">
              <GlossaryText text={emptyNotice} />
            </p>
          )}

          {practicalLastDart && (
            <section className="practice__routes" aria-label="この条件での実戦推奨">
              <h2 className="practice__heading">
                {planDiverges ? ALTERNATIVE_HEADING : '最後の1本の実戦推奨'}
              </h2>
              <RouteCard
                testId="practical-last-dart"
                badge={planDiverges ? ALTERNATIVE_BADGE : '実戦推奨'}
                dartIds={[practicalLastDart.dartId]}
                reasons={practicalLastDartReasonViews(
                  practicalLastDart,
                  suggestion.mode === 'setup' ? bestSetup?.darts[0]?.id ?? null : nextVisitRoute?.darts[0]?.id ?? null,
                )}
                reasonsAlwaysVisible
                onDartFocus={focusDefaultDart}
                focusedDartId={focusedDartId}
              />
            </section>
          )}

          {suggestion.mode === 'setup' && bestSetup && !practicalLastDart && (
            <section className="practice__routes" aria-label="推奨セットアップ">
              <h2 className="practice__heading">
                {planDiverges
                  ? `残り ${visit.remaining} からの${ALTERNATIVE_HEADING}`
                  : entering
                    ? `残り ${visit.remaining} から次ラウンドの残しを作る`
                    : '次ラウンドの残しを作る'}
              </h2>
              <RouteCard
                testId="standard-route"
                badge={planDiverges ? ALTERNATIVE_BADGE : 'BEST'}
                grade={bestSetup.grade}
                dartIds={bestSetup.darts.map((dart) => dart.id)}
                meta={`取得 ${bestSetup.scored} 点 → 残り ${bestSetup.leave}`}
                reasons={toReasonViews(bestSetup.reasons)}
                curatedExplanation={CURATED_SETUP_EXPLANATIONS[visit.remaining] ?? null}
                onDartFocus={focusDefaultDart}
                focusedDartId={focusedDartId}
                defaultOpen
              />
              {/*
                別の場面（T20 が 2 本入ったとき）の書き下ろし。BEST の説明と混ざらないよう、
                カードの外に見出しを付けて出す（監査フェーズ 2 / 2-2）。
              */}
              {CURATED_SETUP_LINE_EXAMPLES[visit.remaining] && (
                <aside className="practice__line-example" data-testid="setup-line-example">
                  <h3 className="practice__line-example-heading">
                    別の展開例：{CURATED_SETUP_LINE_EXAMPLES[visit.remaining].heading}
                  </h3>
                  <p className="practice__line-example-text">
                    {CURATED_SETUP_LINE_EXAMPLES[visit.remaining].text}
                  </p>
                </aside>
              )}
            </section>
          )}

          {/*
            1.5. 上がれないときの答え —— 盤面より前に置く。
            判断を増やさないよう最適候補 1 件だけを出す。理由は他のカードと同じく要約と折りたたみで出す
            （2026-11-01 監査フェーズ 2 / 2-6。以前は理由を出しておらず、なぜその残しなのかが分からなかった）。
          */}
          {suggestion.mode === 'checkout' && nextVisitRoute && !practicalLastDart && (
            <section className="practice__routes" aria-label="次ラウンドへの残し">
              <h2 className="practice__heading">
                {planDiverges ? ALTERNATIVE_HEADING : '次ラウンドへ整える'}
              </h2>
              <RouteCard
                testId="next-visit-route"
                badge={planDiverges ? ALTERNATIVE_BADGE : 'NEXT VISIT'}
                dartIds={nextVisitRoute.darts.map((dart) => dart.id)}
                meta={`取得 ${nextVisitRoute.scored} 点 → 残り ${nextVisitRoute.leave}`}
                reasons={toReasonViews(nextVisitRoute.reasons)}
                onDartFocus={focusDefaultDart}
                focusedDartId={focusedDartId}
              />
            </section>
          )}

          {/*
            最後の 1 本では答えを実戦推奨の 1 つに絞る（2026-11-01 監査 U-M4）。
            狙い通りに入ったときの残しだけで選んだ例は、たたんだ参考として残す。
          */}
          {practicalLastDart &&
            ((suggestion.mode === 'setup' && bestSetup) ||
              (suggestion.mode === 'checkout' && nextVisitRoute)) && (
              <details className="practice__aside" data-testid="practical-reference">
                <summary>参考：狙い通りに入ったときの残しだけで選んだ例</summary>
                {suggestion.mode === 'setup' && bestSetup ? (
                  <RouteCard
                    testId="standard-route"
                    badge="参考"
                    dartIds={bestSetup.darts.map((dart) => dart.id)}
                    meta={`取得 ${bestSetup.scored} 点 → 残り ${bestSetup.leave}`}
                    reasons={toReasonViews(bestSetup.reasons)}
                    onDartFocus={focusDefaultDart}
                    focusedDartId={focusedDartId}
                  />
                ) : (
                  nextVisitRoute && (
                    <RouteCard
                      testId="next-visit-route"
                      badge="参考"
                      dartIds={nextVisitRoute.darts.map((dart) => dart.id)}
                      meta={`取得 ${nextVisitRoute.scored} 点 → 残り ${nextVisitRoute.leave}`}
                      reasons={toReasonViews(nextVisitRoute.reasons)}
                      onDartFocus={focusDefaultDart}
                      focusedDartId={focusedDartId}
                    />
                  )
                )}
              </details>
            )}

          {/*
            残り 1 本では、エリアへの 1 投で上がれることはない。
            チェックアウトの狙いとしては出さず、その事実と Bust の注意だけを伝える。
          */}
          {aimArea && !aimArea.canFinishThisVisit && (
            <AimAreaCard
              key={`${aimArea.left}-${aimArea.dartsLeft}`}
              analysis={aimArea}
              preferredDoubles={preferences.preferredDoubles}
            />
          )}

          {/*
            2. 実戦入力 —— 答えの直後。
            提案が出ない状況（Bust・3 投使い切り）でも操作を続けられるよう、
            ルートの表示条件とは切り離してここへ置く。
          */}
          {recoverySection}

          {/* 3. その他の候補 —— 通常はここまでスクロールしない前提の位置。 */}
          {suggestion.mode === 'checkout' && standardRoute && (
            <section className="practice__routes practice__routes--others" aria-label="その他のルート">
              {myRoute && myRoute.key !== standardRoute.key && (
                <>
                  <h2 className="practice__heading">MY ROUTE</h2>
                  <RouteCard
                    testId="my-route"
                    badge="MY ROUTE"
                    grade={myRoute.grade}
                    dartIds={myRoute.darts.map((dart) => dart.id)}
                    reasons={toReasonViews(myRoute.reasons)}
                    onDartFocus={(dartId) =>
                      selectRoute(
                        dartId,
                        'my',
                        myRoute.darts.map((dart) => dart.id),
                      )
                    }
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
                        onDartFocus={(dartId) =>
                          selectRoute(
                            dartId,
                            'other-checkout',
                            route.darts.map((dart) => dart.id),
                          )
                        }
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
            <section className="practice__routes practice__routes--others" aria-label="その他のセットアップ候補">
              <h2 className="practice__heading">OTHER ROUTES</h2>
              {otherRoutesContext && <p className="practice__grade-note">{otherRoutesContext}</p>}
              <div className="practice__list" data-testid="setup-routes">
                {visibleSetup.map((route) => (
                  <RouteCard
                    key={route.key}
                    testId={`setup-${route.key}`}
                    grade={route.grade}
                    gradeContext={otherRoutesContext ?? undefined}
                    dartIds={route.darts.map((dart) => dart.id)}
                    meta={`取得 ${route.scored} 点 → 残り ${route.leave}`}
                    reasons={toReasonViews(route.reasons)}
                    onDartFocus={(dartId) =>
                      selectRoute(
                        dartId,
                        'other-setup',
                        route.darts.map((dart) => dart.id),
                      )
                    }
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

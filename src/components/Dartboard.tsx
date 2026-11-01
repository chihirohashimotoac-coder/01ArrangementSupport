import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SEGMENTS, type SegmentDefinition } from '../domain/segments';
import {
  RADII,
  VIEWBOX,
  buildNumberLabelPositions,
  buildSegmentPath,
  buildWedgeAreas,
  segmentCenter,
  buildWireLines,
} from '../geometry/dartboardGeometry';
import './Dartboard.css';

/**
 * ナンバー（ウェッジ）単位で選ばせるモードの設定。
 *
 * SETUP の回答は「どのナンバーを狙うか」なので、62 区画ではなく
 * 1 ナンバーぶんの扇形をそのままタップさせる（v1.3.5）。
 */
export interface WedgeSelection {
  /** 選択中のナンバー。未選択は null。 */
  readonly selected: number | null;
  readonly onSelect: (aimNumber: number) => void;
  /** 読み上げ用のラベル。既定は「20 のエリア」。 */
  readonly ariaLabelOf?: (aimNumber: number) => string;
}

/**
 * 盤面へ重ねる印（SIMULATION の狙い・着弾表示）。
 *
 * 座標は SVG（表示）座標系。`aim` は狙い点の十字、`hit` は着弾のダーツ。
 * 盤面の選択動作には一切影響しない（`pointer-events: none`）。
 */
export interface BoardMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: 'aim' | 'hit' | 'past';
  /** 読み上げ用の説明。 */
  readonly label?: string;
}

export interface DartboardProps {
  /** 区画がタップ／キー操作で選ばれたとき。 */
  onSelect?: (segment: SegmentDefinition) => void;
  /** ナンバー単位で選ばせる場合の設定。渡すと区画の選択は無効になる。 */
  wedgeSelection?: WedgeSelection;
  /** 強調表示する Dart（例: ルート内のセグメント）。 */
  highlightedDartIds?: readonly string[];
  /** 特に目立たせる 1 つ（「次に狙う的」）。 */
  focusDartId?: string | null;
  disabled?: boolean;
  /** 操作できない理由。 */
  disabledReason?: string;
  ariaLabel?: string;
  /** 盤面へ重ねる印（狙い・着弾）。 */
  markers?: readonly BoardMarker[];
}

const SEGMENT_PATHS: ReadonlyArray<{ segment: SegmentDefinition; d: string }> = SEGMENTS.map(
  (segment) => ({ segment, d: buildSegmentPath(segment) }),
);

const NUMBER_LABELS = buildNumberLabelPositions();
const WIRE_LINES = buildWireLines();
const WEDGE_AREAS = buildWedgeAreas();

/*
 * キーボード操作（2026-11-01 監査 D-M4）。
 *
 * 盤面全体を Tab 1 か所にまとめ（roving tabindex）、中は矢印キーで移る。
 *   ← / → : 隣のナンバー（同じリング）。BULL では何もしない
 *   ↑ / ↓ : 外側 / 内側のリング（D-BULL → S-BULL → 内側シングル → トリプル → 外側シングル → ダブル → MISS）
 */
const RING_ORDER = ['inner-bull', 'outer-bull', 'inner-single', 'triple', 'outer-single', 'double', 'miss'] as const;
const SEGMENT_BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));
const RING_INDEX_NUMBER = new Map(
  SEGMENTS.filter((segment) => segment.index !== null).map((segment) => [
    `${segment.ring}/${segment.index}`,
    segment.id,
  ]),
);
const DEFAULT_SEGMENT_ID = 'segment-t20';

/** 番号札を置く区画（シングルは外側のシングルを代表にする）。 */
const BADGE_SEGMENT_BY_DART = new Map(
  SEGMENTS.filter((segment) => segment.ring !== 'inner-single' && segment.ring !== 'miss').map(
    (segment) => [segment.dart.id, segment],
  ),
);

function segmentAt(ring: (typeof RING_ORDER)[number], index: number): string {
  if (ring === 'inner-bull') return 'segment-inner-bull';
  if (ring === 'outer-bull') return 'segment-outer-bull';
  if (ring === 'miss') return 'segment-miss';
  return RING_INDEX_NUMBER.get(`${ring}/${index}`) ?? DEFAULT_SEGMENT_ID;
}

/** 矢印キーで移る先の区画。動かないキーなら null。 */
function nextSegmentId(currentId: string, key: string, lastIndex: number): string | null {
  const current = SEGMENT_BY_ID.get(currentId);
  if (current === undefined) return null;
  const ringIndex = RING_ORDER.indexOf(current.ring as (typeof RING_ORDER)[number]);
  const index = current.index ?? lastIndex;
  const count = 20;
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    if (current.index === null) return null;
    const step = key === 'ArrowRight' ? 1 : -1;
    return segmentAt(current.ring as (typeof RING_ORDER)[number], (index + step + count) % count);
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const nextRing = RING_ORDER[ringIndex + (key === 'ArrowUp' ? 1 : -1)];
    return nextRing === undefined ? null : segmentAt(nextRing, index);
  }
  return null;
}

function DartboardComponent({
  onSelect,
  wedgeSelection,
  highlightedDartIds,
  focusDartId,
  disabled = false,
  disabledReason,
  ariaLabel,
  markers,
}: DartboardProps) {
  const highlighted = useMemo(() => new Set(highlightedDartIds ?? []), [highlightedDartIds]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Tab で止まる 1 か所（roving tabindex）。 */
  const [activeId, setActiveId] = useState(DEFAULT_SEGMENT_ID);
  /** ナンバーの位置を覚えておき、BULL から外へ戻るときに元のナンバーへ戻る。 */
  const lastIndex = useRef(0);
  /** キーボードでフォーカスしている区画（最前面に輪郭を描く）。 */
  const [keyboardFocusId, setKeyboardFocusId] = useState<string | null>(null);
  const [activeWedge, setActiveWedge] = useState(20);
  const wedgeMode = wedgeSelection !== undefined;
  const interactive = !disabled && !wedgeMode && typeof onSelect === 'function';
  const wedgeInteractive = !disabled && wedgeMode;

  const moveFocus = (event: KeyboardEvent<SVGPathElement>, currentId: string) => {
    const next = nextSegmentId(currentId, event.key, lastIndex.current);
    if (next === null) return;
    event.preventDefault();
    setActiveId(next);
    svgRef.current?.querySelector<SVGPathElement>(`[data-testid="${next}"]`)?.focus();
  };

  const moveWedgeFocus = (event: KeyboardEvent<SVGPathElement>, current: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const order = WEDGE_AREAS.map((wedge) => wedge.value);
    const position = order.indexOf(current);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = order[(position + step + order.length) % order.length];
    setActiveWedge(next);
    svgRef.current?.querySelector<SVGPathElement>(`[data-wedge="${next}"]`)?.focus();
  };

  /*
   * 投げる順番の番号札（2026-11-01 監査 D-M3）。同じ的を続けて狙うときは「1·2」のように並べる。
   */
  const orderBadges = (() => {
    const ids = highlightedDartIds ?? [];
    const byDart = new Map<string, number[]>();
    ids.forEach((id, index) => byDart.set(id, [...(byDart.get(id) ?? []), index + 1]));
    return [...byDart.entries()].flatMap(([dartId, orders]) => {
      const segment = BADGE_SEGMENT_BY_DART.get(dartId);
      if (segment === undefined) return [];
      return [{ dartId, label: orders.join('·'), center: segmentCenter(segment) }];
    });
  })();

  const focusRingPath =
    keyboardFocusId === null
      ? null
      : (SEGMENT_PATHS.find(({ segment }) => segment.id === keyboardFocusId)?.d ?? null);

  return (
    <div className="dartboard" data-testid="dartboard" data-mode={wedgeMode ? 'wedge' : 'segment'}>
      <svg
        viewBox={VIEWBOX}
        ref={svgRef}
        className="dartboard__svg"
        role="group"
        aria-label={
          ariaLabel ?? 'ダーツボード。区画を選ぶと、そこへ投げた／狙ったこととして記録します。'
        }
        aria-disabled={disabled}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* 狙う的の斜線（色だけに頼らない印。2026-11-01 監査 D-M3）。 */}
          <pattern id="dartboard-target-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="dartboard__hatch-line" />
          </pattern>
        </defs>
        <circle className="dartboard__backdrop" cx={0} cy={0} r={RADII.missOuter} />

        <g className="dartboard__segments" aria-hidden={wedgeMode ? true : undefined}>
        {SEGMENT_PATHS.map(({ segment, d }) => {
          const isHighlighted = highlighted.has(segment.dart.id);
          const isFocused = focusDartId !== null && focusDartId === segment.dart.id;
          return (
            <path
              key={segment.id}
              id={segment.id}
              data-testid={segment.id}
              data-segment-ring={segment.ring}
              data-dart={segment.dart.id}
              data-highlighted={isHighlighted ? 'true' : undefined}
              data-focused={isFocused ? 'true' : undefined}
              className={`dartboard__segment dartboard__segment--${segment.colorGroup}`}
              d={d}
              fillRule={segment.ring === 'miss' ? 'evenodd' : undefined}
              role={interactive ? 'button' : 'presentation'}
              tabIndex={interactive && segment.id === activeId ? 0 : -1}
              aria-label={segment.ariaLabel}
              aria-disabled={disabled}
              /* 入力は click のみで受ける。touchstart 併用は二重入力になるため使わない。 */
              onClick={() => {
                if (!interactive) return;
                setActiveId(segment.id);
                onSelect?.(segment);
              }}
              onFocus={(event) => {
                setActiveId(segment.id);
                if (segment.index !== null) lastIndex.current = segment.index;
                setKeyboardFocusId(event.currentTarget.matches(':focus-visible') ? segment.id : null);
              }}
              onBlur={() => setKeyboardFocusId(null)}
              onKeyDown={(event) => {
                if (!interactive) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(segment);
                  return;
                }
                moveFocus(event, segment.id);
              }}
            />
          );
        })}
        </g>

        {wedgeMode && (
          <g className="dartboard__wedges">
            {WEDGE_AREAS.map((wedge) => (
              <path
                key={wedge.value}
                data-testid={`wedge-${wedge.value}`}
                data-wedge={wedge.value}
                data-selected={wedgeSelection.selected === wedge.value ? 'true' : undefined}
                className="dartboard__wedge"
                d={wedge.d}
                role="button"
                tabIndex={wedgeInteractive && wedge.value === activeWedge ? 0 : -1}
                aria-label={wedgeSelection.ariaLabelOf?.(wedge.value) ?? `${wedge.value} のエリア`}
                aria-pressed={wedgeSelection.selected === wedge.value}
                aria-disabled={disabled}
                onClick={() => {
                  if (wedgeInteractive) wedgeSelection.onSelect(wedge.value);
                }}
                onFocus={() => setActiveWedge(wedge.value)}
                onKeyDown={(event) => {
                  if (!wedgeInteractive) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    wedgeSelection.onSelect(wedge.value);
                    return;
                  }
                  moveWedgeFocus(event, wedge.value);
                }}
              />
            ))}
          </g>
        )}

        <g className="dartboard__wires" aria-hidden="true">
          {WIRE_LINES.map((line, index) => (
            <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          ))}
          <circle cx={0} cy={0} r={RADII.doubleOuter} />
          <circle cx={0} cy={0} r={RADII.doubleInner} />
          <circle cx={0} cy={0} r={RADII.tripleOuter} />
          <circle cx={0} cy={0} r={RADII.tripleInner} />
          <circle cx={0} cy={0} r={RADII.outerBull} />
          <circle cx={0} cy={0} r={RADII.innerBull} />
        </g>

        <g className="dartboard__numbers" aria-hidden="true">
          {NUMBER_LABELS.map((label) => (
            <text key={label.value} x={label.x} y={label.y}>
              {label.value}
            </text>
          ))}
        </g>

        {/* 狙う的の斜線と、白黒 2 重の縁（色覚の違いがあっても見分けられるように）。 */}
        {highlighted.size > 0 && (
          <g className="dartboard__targets" aria-hidden="true">
            {SEGMENT_PATHS.filter(({ segment }) => highlighted.has(segment.dart.id)).map(({ segment, d }) => (
              <g key={segment.id}>
                <path className="dartboard__target-edge-outer" d={d} />
                <path className="dartboard__target-edge-inner" d={d} />
                <path className="dartboard__target-hatch" d={d} fill="url(#dartboard-target-hatch)" />
              </g>
            ))}
          </g>
        )}

        {orderBadges.length > 0 && (
          <g className="dartboard__badges" aria-hidden="true">
            {orderBadges.map((badge) => (
              <g
                key={badge.dartId}
                className="dartboard__badge"
                data-testid={`board-order-${badge.dartId}`}
                transform={`translate(${badge.center.x} ${badge.center.y})`}
              >
                <circle r={badge.label.length > 1 ? 13 : 10} />
                <text dy="0.35em">{badge.label}</text>
              </g>
            ))}
          </g>
        )}

        {/*
          キーボードでフォーカスしている区画の輪郭は、最前面の別レイヤーに描く
          （区画自身の stroke は隣の区画に隠れてほぼ見えなかった。2026-11-01 監査 D-M4）。
        */}
        {focusRingPath !== null && (
          <g className="dartboard__focus-ring" aria-hidden="true" data-testid="board-focus-ring">
            <path className="dartboard__focus-ring-outer" d={focusRingPath} />
            <path className="dartboard__focus-ring-inner" d={focusRingPath} />
          </g>
        )}

        {markers !== undefined && markers.length > 0 && (
          <g className="dartboard__markers">
            {markers.map((marker) => (
              <g
                key={marker.id}
                className={`dartboard__marker dartboard__marker--${marker.kind}`}
                data-testid={`board-marker-${marker.id}`}
                data-marker-kind={marker.kind}
                transform={`translate(${marker.x} ${marker.y})`}
              >
                {marker.label !== undefined && <title>{marker.label}</title>}
                {marker.kind === 'aim' ? (
                  <>
                    <circle className="dartboard__marker-ring" r={11} />
                    <line x1={-16} y1={0} x2={16} y2={0} />
                    <line x1={0} y1={-16} x2={0} y2={16} />
                  </>
                ) : (
                  <>
                    <circle className="dartboard__marker-halo" r={9} />
                    <circle className="dartboard__marker-dot" r={4.5} />
                  </>
                )}
              </g>
            ))}
          </g>
        )}
      </svg>

      {disabled && disabledReason && (
        <p className="dartboard__disabled-reason" data-testid="board-disabled-reason">
          {disabledReason}
        </p>
      )}
    </div>
  );
}

export const Dartboard = memo(DartboardComponent);

import { memo, useMemo } from 'react';
import { SEGMENTS, type SegmentDefinition } from '../domain/segments';
import {
  RADII,
  VIEWBOX,
  buildNumberLabelPositions,
  buildSegmentPath,
  buildWedgeAreas,
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
}

const SEGMENT_PATHS: ReadonlyArray<{ segment: SegmentDefinition; d: string }> = SEGMENTS.map(
  (segment) => ({ segment, d: buildSegmentPath(segment) }),
);

const NUMBER_LABELS = buildNumberLabelPositions();
const WIRE_LINES = buildWireLines();
const WEDGE_AREAS = buildWedgeAreas();

function DartboardComponent({
  onSelect,
  wedgeSelection,
  highlightedDartIds,
  focusDartId,
  disabled = false,
  disabledReason,
  ariaLabel,
}: DartboardProps) {
  const highlighted = useMemo(() => new Set(highlightedDartIds ?? []), [highlightedDartIds]);
  const wedgeMode = wedgeSelection !== undefined;
  const interactive = !disabled && !wedgeMode && typeof onSelect === 'function';
  const wedgeInteractive = !disabled && wedgeMode;

  return (
    <div className="dartboard" data-testid="dartboard" data-mode={wedgeMode ? 'wedge' : 'segment'}>
      <svg
        viewBox={VIEWBOX}
        className="dartboard__svg"
        role="group"
        aria-label={
          ariaLabel ?? 'ダーツボード。区画を選ぶと、そこへ投げた／狙ったこととして記録します。'
        }
        aria-disabled={disabled}
        xmlns="http://www.w3.org/2000/svg"
      >
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
              tabIndex={interactive ? 0 : -1}
              aria-label={segment.ariaLabel}
              aria-disabled={disabled}
              /* 入力は click のみで受ける。touchstart 併用は二重入力になるため使わない。 */
              onClick={() => {
                if (interactive) onSelect?.(segment);
              }}
              onKeyDown={(event) => {
                if (!interactive) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(segment);
                }
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
                tabIndex={wedgeInteractive ? 0 : -1}
                aria-label={wedgeSelection.ariaLabelOf?.(wedge.value) ?? `${wedge.value} のエリア`}
                aria-pressed={wedgeSelection.selected === wedge.value}
                aria-disabled={disabled}
                onClick={() => {
                  if (wedgeInteractive) wedgeSelection.onSelect(wedge.value);
                }}
                onKeyDown={(event) => {
                  if (!wedgeInteractive) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    wedgeSelection.onSelect(wedge.value);
                  }
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

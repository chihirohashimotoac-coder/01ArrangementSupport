import { memo, useMemo } from 'react';
import { SEGMENTS, type SegmentDefinition } from '../domain/segments';
import {
  RADII,
  VIEWBOX,
  buildNumberLabelPositions,
  buildSegmentPath,
  buildWireLines,
} from '../geometry/dartboardGeometry';
import './Dartboard.css';

export interface DartboardProps {
  /** 区画がタップ／キー操作で選ばれたとき。 */
  onSelect?: (segment: SegmentDefinition) => void;
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

function DartboardComponent({
  onSelect,
  highlightedDartIds,
  focusDartId,
  disabled = false,
  disabledReason,
  ariaLabel,
}: DartboardProps) {
  const highlighted = useMemo(() => new Set(highlightedDartIds ?? []), [highlightedDartIds]);
  const interactive = !disabled && typeof onSelect === 'function';

  return (
    <div className="dartboard" data-testid="dartboard">
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

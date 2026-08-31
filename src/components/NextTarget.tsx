import type { VisitStatus } from '../engine/recovery/visit';
import './NextTarget.css';

export interface NextTargetProps {
  readonly remaining: number;
  readonly dartsLeft: number;
  readonly status: VisitStatus;
  /** 実際の着弾を 1 投でも入力したか。 */
  readonly hasThrown: boolean;
  /** 次に狙う推奨ルート。無ければ null。 */
  readonly dartIds: readonly string[] | null;
  readonly onUndo: () => void;
}

/**
 * 盤面直下に置くコンパクトな現在地表示。
 *
 * 「外した → 次どこ？」だけを最短で読ませるのが役割なので、理由は載せない
 * （理由は上の STANDARD / BEST カードに残す）。誤タップの訂正も同じ場所で
 * 済むよう、「1投戻す」をここへ置く。
 */
export function NextTarget({
  remaining,
  dartsLeft,
  status,
  hasThrown,
  dartIds,
  onUndo,
}: NextTargetProps) {
  const message =
    status === 'bust'
      ? 'BUST — このビジットの得点は無効です。次のビジットへ進んでください。'
      : status === 'checkout'
        ? 'CHECKOUT! 上がりました。'
        : dartsLeft === 0
          ? '3 投を使い切りました。次のビジットへ進んでください。'
          : null;

  return (
    <div className="next-target" data-testid="recovery-next">
      <p className="next-target__status">
        <span className="next-target__number" data-testid="next-remaining">
          {remaining}
        </span>
        <span className="next-target__unit">LEFT</span>
        <span className="next-target__sep" aria-hidden="true">
          /
        </span>
        <span className="next-target__number next-target__number--small" data-testid="next-darts">
          {dartsLeft}
        </span>
        <span className="next-target__unit">DARTS</span>
      </p>

      {message ? (
        <p className="next-target__message" data-testid="recovery-next-message">
          {message}
        </p>
      ) : (
        hasThrown &&
        dartIds !== null &&
        dartIds.length > 0 && (
          <div className="next-target__route" data-testid="recovery-next-route">
            <span className="next-target__label">NEXT</span>
            <ol className="next-target__darts" aria-label="次に狙うルート">
              {dartIds.map((dartId, index) => (
                <li key={`${dartId}-${index}`}>{dartId}</li>
              ))}
            </ol>
          </div>
        )
      )}

      <button
        type="button"
        className="next-target__undo"
        data-testid="undo-button"
        onClick={onUndo}
        disabled={!hasThrown}
      >
        1投戻す
      </button>
    </div>
  );
}

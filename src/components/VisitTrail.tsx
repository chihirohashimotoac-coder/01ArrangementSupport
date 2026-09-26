import type { VisitState } from '../engine/recovery/visit';
import './VisitTrail.css';

export interface VisitTrailProps {
  readonly visit: VisitState;
  readonly onNextVisit: () => void;
  readonly onReset: () => void;
}

/**
 * 実際に記録した残りの投球と、次の3投への操作。
 *
 * 「1投戻す」はここではなく盤面直下（NextTarget）に置く。誤タップの訂正は
 * 盤面を見たまま行う操作なので、盤面から離すと探しに行くことになる。
 */
export function VisitTrail({ visit, onNextVisit, onReset }: VisitTrailProps) {
  const unknownBust = visit.status === 'bust' && !visit.visitStartKnown;
  const finished = (visit.status !== 'in-progress' || visit.dartsLeft === 0) && !unknownBust;

  return (
    <div className="visit-trail" data-testid="visit-trail">
      <ol className="visit-trail__list" aria-label="この参照からの投球記録">
        {Array.from({ length: visit.initialDartsLeft }, (_, index) => {
          const thrown = visit.thrown[index];
          return (
            <li key={index} data-filled={thrown ? 'true' : undefined}>
              <span className="visit-trail__index">{4 - visit.initialDartsLeft + index}</span>
              <span className="visit-trail__dart" data-testid={`thrown-${index}`}>
                {thrown ? thrown.dart.id : '—'}
              </span>
              <span className="visit-trail__after">
                {thrown ? `→ ${thrown.outcome === 'bust' ? 'BUST' : thrown.remainingAfter}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="visit-trail__actions">
        <button type="button" data-testid="next-visit-button" onClick={onNextVisit} disabled={!finished}>
          次の3投へ
        </button>
        {!unknownBust && (
          <button type="button" data-testid="reset-button" onClick={onReset}>
            最初から
          </button>
        )}
      </div>
    </div>
  );
}

import type { VisitState } from '../engine/recovery/visit';
import './VisitTrail.css';

export interface VisitTrailProps {
  readonly visit: VisitState;
  readonly onNextVisit: () => void;
  readonly onReset: () => void;
}

/**
 * 実際に投げたこの 3 投の記録と、3 投単位のやり直し操作。
 *
 * 「1投戻す」はここではなく盤面直下（NextTarget）に置く。誤タップの訂正は
 * 盤面を見たまま行う操作なので、盤面から離すと探しに行くことになる。
 */
export function VisitTrail({ visit, onNextVisit, onReset }: VisitTrailProps) {
  const finished = visit.status !== 'in-progress' || visit.dartsLeft === 0;

  return (
    <div className="visit-trail" data-testid="visit-trail">
      <ol className="visit-trail__list" aria-label="この3投の記録">
        {[0, 1, 2].map((index) => {
          const thrown = visit.thrown[index];
          return (
            <li key={index} data-filled={thrown ? 'true' : undefined}>
              <span className="visit-trail__index">{index + 1}</span>
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
        <button type="button" data-testid="reset-button" onClick={onReset}>
          最初から
        </button>
      </div>
    </div>
  );
}

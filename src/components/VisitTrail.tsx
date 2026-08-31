import type { VisitState } from '../engine/recovery/visit';
import './VisitTrail.css';

export interface VisitTrailProps {
  readonly visit: VisitState;
  readonly onUndo: () => void;
  readonly onNextVisit: () => void;
  readonly onReset: () => void;
}

/** このビジットで実際に投げた 3 投の記録と、やり直し操作。 */
export function VisitTrail({ visit, onUndo, onNextVisit, onReset }: VisitTrailProps) {
  const finished = visit.status !== 'in-progress' || visit.dartsLeft === 0;

  return (
    <div className="visit-trail" data-testid="visit-trail">
      <ol className="visit-trail__list" aria-label="このビジットの記録">
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
        <button
          type="button"
          data-testid="undo-button"
          onClick={onUndo}
          disabled={visit.thrown.length === 0}
        >
          1投戻す
        </button>
        <button type="button" data-testid="next-visit-button" onClick={onNextVisit} disabled={!finished}>
          次のビジットへ
        </button>
        <button type="button" data-testid="reset-button" onClick={onReset}>
          最初から
        </button>
      </div>
    </div>
  );
}

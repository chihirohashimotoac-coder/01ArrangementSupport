import { useId, useState } from 'react';
import type { RouteGrade } from '../data/rankingRules';
import type { ReasonPolarity } from '../domain/reasonCodes';
import './RouteCard.css';

export interface RouteReasonView {
  readonly code: string;
  readonly polarity: ReasonPolarity;
  readonly label: string;
  readonly summary: string;
  readonly detail: string | null;
}

export interface RouteCardProps {
  /** ルートを構成するセグメント表記。 */
  readonly dartIds: readonly string[];
  readonly grade?: RouteGrade;
  /** 見出しのラベル（STANDARD / MY ROUTE など）。 */
  readonly badge?: string;
  readonly isStandard?: boolean;
  readonly reasons: readonly RouteReasonView[];
  /** 人間が書き下ろした説明（あれば要約の先頭に出す）。 */
  readonly curatedExplanation?: string | null;
  /** 補足行（SETUP の「残り 164」など）。 */
  readonly meta?: string | null;
  /** セグメントをタップしたとき（盤面で位置を確認する）。 */
  readonly onDartFocus?: (dartId: string) => void;
  readonly focusedDartId?: string | null;
  readonly defaultOpen?: boolean;
  readonly testId?: string;
}

const GRADE_LABEL: Record<RouteGrade, string> = {
  S: '基準推奨',
  A: '非常に良い代替',
  B: '十分実用的',
  C: '成立するが非推奨',
};

/**
 * 1 ルートの表示。
 *
 * 理由は「短い要約」→「詳細を開く」の progressive disclosure にする。
 * 長文で画面を埋めない、という UI 方針（31 節）に対応する。
 */
export function RouteCard({
  dartIds,
  grade,
  badge,
  isStandard = false,
  reasons,
  curatedExplanation,
  meta,
  onDartFocus,
  focusedDartId,
  defaultOpen = false,
  testId,
}: RouteCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const detailsId = useId();

  const positives = reasons.filter((reason) => reason.polarity === 'positive');
  const negatives = reasons.filter((reason) => reason.polarity === 'negative');
  const headline = curatedExplanation ?? negatives[0]?.summary ?? positives[0]?.summary ?? null;

  return (
    <article
      className={`route-card${isStandard ? ' route-card--standard' : ''}`}
      data-testid={testId}
      data-grade={grade}
    >
      <header className="route-card__header">
        {badge && <span className="route-card__badge">{badge}</span>}
        {grade && (
          <span className={`route-card__grade route-card__grade--${grade}`}>
            <span aria-hidden="true">{grade}</span>
            <span className="visually-hidden">{`推奨度 ${grade}: ${GRADE_LABEL[grade]}`}</span>
          </span>
        )}
      </header>

      <ol className="route-card__darts" aria-label="ルート">
        {dartIds.map((dartId, index) => (
          <li key={`${dartId}-${index}`}>
            <button
              type="button"
              className="route-card__dart"
              data-dart={dartId}
              data-active={focusedDartId === dartId ? 'true' : undefined}
              onClick={() => onDartFocus?.(dartId)}
              aria-label={`${index + 1} 投目 ${dartId}。盤面で位置を確認する`}
            >
              {dartId}
            </button>
          </li>
        ))}
      </ol>

      {meta && <p className="route-card__meta">{meta}</p>}

      {headline && (
        <p className="route-card__headline" data-testid={testId ? `${testId}-headline` : undefined}>
          {headline}
        </p>
      )}

      {reasons.length > 0 && (
        <>
          <button
            type="button"
            className="route-card__toggle"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '理由を閉じる' : 'WHY THIS ROUTE? — 理由を見る'}
          </button>
          <div id={detailsId} className="route-card__reasons" hidden={!open}>
            <ul>
              {reasons.map((reason) => (
                <li key={reason.code} data-polarity={reason.polarity} data-code={reason.code}>
                  <span className="route-card__reason-label">{reason.label}</span>
                  <span className="route-card__reason-summary">{reason.summary}</span>
                  {reason.detail && (
                    <span className="route-card__reason-detail">{reason.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </article>
  );
}

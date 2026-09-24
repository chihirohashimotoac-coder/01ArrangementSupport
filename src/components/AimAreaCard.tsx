import { useId, useState } from 'react';
import {
  AIM_LANDING_GROUP_LABEL_JA,
  AIM_LANDING_KIND_LABEL_JA,
  aimAreaCautionJa,
  aimAreaLeadJa,
  aimAreaNotesJa,
  aimAreaTitleJa,
  aimLandingOutcomeJa,
} from '../data/aimAreaExplanations';
import type { AimAreaAnalysis, AimLandingRole } from '../engine/aimArea/aimArea';
import './AimAreaCard.css';

export interface AimAreaCardProps {
  readonly analysis: AimAreaAnalysis;
  /**
   * 得意ダブル（設定）。上がりのダブルに「得意」と注記するだけで、
   * 並び順・内容は変えない。未設定なら何も付けない。
   */
  readonly preferredDoubles?: readonly string[];
  readonly testId?: string;
}

const GROUPS: readonly AimLandingRole[] = ['area', 'outside'];

/**
 * 「盤面の狙い方」— 隣り合うシングルを一まとまりの的として見る教材。
 *
 * 基準ルートの表示・順位には関与しない読み取り専用の補足。
 * 既定はたたんでおき、Bust する的があるときだけ、その注意をたたんだままでも見せる。
 */
export function AimAreaCard({ analysis, preferredDoubles = [], testId = 'aim-area' }: AimAreaCardProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const caution = aimAreaCautionJa(analysis);
  const notes = aimAreaNotesJa(analysis);

  return (
    <section
      className="aim-area"
      data-testid={testId}
      data-left={analysis.left}
      data-darts-left={analysis.dartsLeft}
      aria-label="盤面の狙い方"
    >
      <p className="aim-area__title">
        <span className="aim-area__kicker">盤面の狙い方</span>
        <span className="aim-area__name">{aimAreaTitleJa(analysis)}</span>
      </p>

      {caution && (
        <p className="aim-area__caution" data-testid={`${testId}-caution`}>
          {caution}
        </p>
      )}

      {!analysis.canFinishThisVisit ? (
        <p className="aim-area__lead" data-testid={`${testId}-lead`}>
          {aimAreaLeadJa(analysis)}
        </p>
      ) : (
        <>
          <button
            type="button"
            className="aim-area__toggle"
            data-testid={`${testId}-toggle`}
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '閉じる' : '入った場所ごとの結果を見る'}
          </button>
          <div id={detailsId} className="aim-area__details" hidden={!open}>
            <p className="aim-area__lead" data-testid={`${testId}-lead`}>
              {aimAreaLeadJa(analysis)}
            </p>
            {GROUPS.map((role) => {
              const landings = analysis.landings.filter((landing) => landing.role === role);
              if (landings.length === 0) return null;
              return (
                <div key={role} className="aim-area__group" data-role={role}>
                  <p className="aim-area__group-label">{AIM_LANDING_GROUP_LABEL_JA[role]}</p>
                  <ul className="aim-area__landings">
                    {landings.map((landing) => {
                      const preferred =
                        landing.finishDartId !== null && preferredDoubles.includes(landing.finishDartId);
                      return (
                        <li
                          key={landing.dart.id}
                          className="aim-area__landing"
                          data-dart={landing.dart.id}
                          data-kind={landing.kind}
                        >
                          <span className="aim-area__dart">{landing.dart.id}</span>
                          <span className="aim-area__outcome">
                            {aimLandingOutcomeJa(landing)}
                            {landing.isStandardFirstDart && (
                              <span className="aim-area__tag aim-area__tag--standard">基準ルート</span>
                            )}
                            {preferred && (
                              <span className="aim-area__tag aim-area__tag--preferred">得意</span>
                            )}
                          </span>
                          <span className="aim-area__kind">{AIM_LANDING_KIND_LABEL_JA[landing.kind]}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            <ul className="aim-area__notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

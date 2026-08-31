import { useMemo } from 'react';
import { usePreferences } from '../hooks/usePreferences';
import { SELECTABLE_FINISH_TARGETS } from '../storage/preferences';
import { DOUBLE_QUALITY } from '../data/rankingRules';
import { STANDARD_ROUTES } from '../data/standardCheckoutRoutes';
import './SettingsPage.css';

/**
 * MY ROUTE の設定。
 *
 * ここで選んだ得意ダブルは MY ROUTE の並びにだけ反映され、
 * STANDARD（基準ルート）の並びは変わらない。
 */
export function SettingsPage() {
  const { preferences, setPreferredDoubles } = usePreferences();
  const selected = preferences.preferredDoubles;

  const approvedV1 = useMemo(
    () => STANDARD_ROUTES.filter((entry) => entry.reviewStatus === 'human-approved-v1').length,
    [],
  );

  const toggle = (id: string) => {
    setPreferredDoubles(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  };

  const move = (index: number, delta: number) => {
    const next = [...selected];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPreferredDoubles(next);
  };

  return (
    <div className="settings">
      <section className="settings__section">
        <h2>MY ROUTE — 得意ダブル</h2>
        <p className="settings__note">
          好きなダブルを順位づけすると、MY ROUTE の候補がその上がりを優先します。
          STANDARD（基準ルート）の並びは変わりません。BULL 上がりも指定できます。
        </p>

        <ol className="settings__ranked" data-testid="preferred-doubles">
          {selected.length === 0 && <li className="settings__empty">まだ選ばれていません。</li>}
          {selected.map((id, index) => (
            <li key={id}>
              <span className="settings__rank">{index + 1}</span>
              <span className="settings__id">{id}</span>
              <span className="settings__reason">{DOUBLE_QUALITY[id]?.reasonJa ?? ''}</span>
              <span className="settings__move">
                <button
                  type="button"
                  aria-label={`${id} を上へ`}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${id} を下へ`}
                  onClick={() => move(index, 1)}
                  disabled={index === selected.length - 1}
                >
                  ↓
                </button>
                <button type="button" aria-label={`${id} を外す`} onClick={() => toggle(id)}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>

        <h3>選択できる上がり</h3>
        <div className="settings__grid" role="group" aria-label="得意ダブルの選択">
          {SELECTABLE_FINISH_TARGETS.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`select-${id}`}
              aria-pressed={selected.includes(id)}
              onClick={() => toggle(id)}
            >
              {id}
            </button>
          ))}
        </div>
      </section>

      <section className="settings__section">
        <h2>データの出典</h2>
        <ul className="settings__data">
          <li>
            LEFT 41〜170 の基準ルートは、添付 Excel の第1候補を取り込んだもの（123 件）。
            アプリ起動時のテストで、合計・最終ダート・Double Out を全件再計算しています。
          </li>
          <li>
            LEFT 2〜40 は Excel に収録がないため、明示ルールで導出しています
            （<strong>{approvedV1} 件・v1 として承認済み</strong>）。
            運用しながら見直す前提の暫定の方針です。
          </li>
          <li>
            出典の一次資料が確認できていないため、「PDC公式ルート」とは呼ばず
            「基準ルート」と表記しています。
          </li>
        </ul>
      </section>
    </div>
  );
}

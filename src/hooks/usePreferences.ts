import { useCallback, useState } from 'react';
import { loadPreferences, savePreferences, type Preferences } from '../storage/preferences';

/** ユーザー設定（MY ROUTE など）を localStorage と同期して扱う。 */
export function usePreferences() {
  // 初期化時に 1 度だけ読む。localStorage が使えない環境では既定値が返る。
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());

  const update = useCallback((next: Preferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);

  const setPreferredDoubles = useCallback(
    (ids: readonly string[]) => {
      update({ ...loadPreferences(), preferredDoubles: [...ids] });
    },
    [update],
  );

  return { preferences, update, setPreferredDoubles };
}

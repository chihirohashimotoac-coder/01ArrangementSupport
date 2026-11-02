/**
 * 残り 2 本・51〜70 の基準ルート（明示ルールによる導出データ）。
 *
 * ============================================================
 *  HUMAN APPROVED (v2) — 2026-11-01 / docs/APPROVALS.md A-27
 *
 *  残り 60 点台を 2 本で狙うときのセオリー「S○ → D-BULL」を、残り 2 本の
 *  基準ルートとして採用する（オーナーの決定）。残り 3 本のときの Excel 第 1 候補は
 *  変えない（standardCheckoutRoutes.generated.ts も Excel も無変更）。
 *  人間が選んだ暫定の戦術方針であり、数学的に一意へ定まる正解ではない。
 *  変更にはあらためて Human Approval が必要（AGENTS.md §2-2）。
 * ============================================================
 *
 *   R3. 51〜60（残り 2 本） → S(残り − 40) → D20
 *   R4. 61〜70（残り 2 本） → S(残り − 50) → BULL（D-BULL）
 */
export interface TwoDartStandardRoute {
  readonly left: number;
  readonly darts: readonly string[];
  readonly rule: 'R3_SINGLE_THEN_D20' | 'R4_SINGLE_THEN_BULL';
}

export const TWO_DART_STANDARD_RANGE = { min: 51, max: 70 } as const;

function deriveRoute(left: number): TwoDartStandardRoute {
  if (left <= 60) return { left, darts: [`S${left - 40}`, 'D20'], rule: 'R3_SINGLE_THEN_D20' };
  return { left, darts: [`S${left - 50}`, 'BULL'], rule: 'R4_SINGLE_THEN_BULL' };
}

/** 残り 2 本・51〜70 の導出結果（20 件）。 */
export const TWO_DART_STANDARD_ROUTES: readonly TwoDartStandardRoute[] = Array.from(
  { length: TWO_DART_STANDARD_RANGE.max - TWO_DART_STANDARD_RANGE.min + 1 },
  (_, i) => deriveRoute(TWO_DART_STANDARD_RANGE.min + i),
);

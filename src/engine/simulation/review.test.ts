import { describe, expect, it } from 'vitest';
import { isBogey } from '../../domain/checkoutRules';
import { rankSetupRoutes } from '../setup/enumerate';
import { rankCheckoutRoutes } from '../ranking/checkoutRanking';
import { suggestFor } from '../recovery/suggest';
import { canReachTenpai, isSingleMissTenpaiSafe } from '../setup/tenpai';
import { requireDart, THROWABLE_DARTS } from '../../domain/dart';
import { MAX_PPR } from './accuracy';
import {
  advanceRound,
  createGame,
  submitScore,
  throwAt,
  type SimulationGame,
  type SimulationSettings,
  type ThrowRecord,
} from './game';
import { analyzeLastDartSetup } from './lastDartSetup';
import { dominatesLeavePair, nextVisitLeaveProfileOf } from './leaveProfile';
import {
  THROW_VERDICTS,
  THROW_VERDICT_HINT_JA,
  THROW_VERDICT_JA,
  buildGameReview,
  reviewThrow,
} from './review';

const PERFECT: SimulationSettings = {
  startScore: 501,
  first9Ppr: MAX_PPR,
  averagePpr: MAX_PPR,
  missDirection: 'even',
  maxMiss: 'medium',
};

/**
 * レビュー判定だけを確かめるための 1 投の記録。
 * 「狙い」と「着弾」を自由に組み合わせられるようにしている。
 */
function record(
  leftBefore: number,
  intendedDartId: string,
  actualDartId: string,
  dartNumber = 1,
): ThrowRecord {
  return {
    round: 1,
    dartNumber,
    dartIndex: dartNumber,
    leftBefore,
    intendedSegmentId: `segment-${intendedDartId.toLowerCase()}`,
    intendedDartId,
    intendedPoint: { x: 0, y: 0 },
    actualPoint: { x: 0, y: 0 },
    actualDartId,
    score: 0,
    leftAfter: leftBefore,
    bust: false,
    bustReason: null,
    checkout: false,
    drawsBefore: 0,
  };
}

/** その場面でアプリが 1 投目に推奨する的。 */
function recommendedFirstDart(left: number, dartsLeft: number): string {
  const suggestion = suggestFor(left, dartsLeft);
  const id =
    suggestion.checkoutRoutes[0]?.darts[0]?.id ??
    suggestion.nextVisitProposals[0]?.route.darts[0]?.id ??
    suggestion.setupRoutes[0]?.darts[0]?.id;
  if (id === undefined) throw new Error(`推奨が得られません: ${left} / ${dartsLeft}`);
  return id;
}

function throwMany(game: SimulationGame, ids: readonly string[]): SimulationGame {
  return ids.reduce((state, id) => throwAt(state, id), game);
}

describe('評価するのは狙いだけ（着弾ミスと判断ミスを混同しない）', () => {
  it('同じ狙いなら、着弾がどこであっても判定は変わらない', () => {
    const left = 125;
    const intended = recommendedFirstDart(left, 3);
    const onTarget = reviewThrow(record(left, intended, intended));
    const wayOff = reviewThrow(record(left, intended, 'S5'));
    const outBoard = reviewThrow(record(left, intended, 'MISS'));

    expect(onTarget.verdict).toBe('GOOD_DECISION');
    expect(wayOff.verdict).toBe(onTarget.verdict);
    expect(outBoard.verdict).toBe(onTarget.verdict);
    expect(wayOff.noteJa).toBe(onTarget.noteJa);
  });

  it('推奨の 1 投目を狙えば、どの残りでも GOOD DECISION になる', () => {
    const notGood: string[] = [];
    for (let left = 2; left <= 170; left += 1) {
      if (isBogey(left)) continue;
      const intended = recommendedFirstDart(left, 3);
      const result = reviewThrow(record(left, intended, 'S1'));
      if (result.verdict !== 'GOOD_DECISION') {
        notGood.push(`${left}: ${intended} → ${result.verdict}`);
      }
    }
    expect(notGood).toEqual([]);
  });

  it('候補一覧の表示件数（40 件）で切って判定しない', () => {
    /*
     * 回帰テスト（Codex レビュー P1）。
     * 171 の T16 → S20 → T20 は推奨度 A だが、41 番目以降にあるため
     * 表示件数のまま判定すると SETUP MISTAKE になってしまっていた。
     */
    const full = rankSetupRoutes(171, 3, { maxRoutes: 100000 });
    const t16 = full.filter((route) => route.darts[0].id === 'T16');
    expect(t16.length).toBeGreaterThan(0);
    expect(t16.some((route) => route.grade === 'S' || route.grade === 'A')).toBe(true);
    // 既定の 40 件には入っていない（この前提が崩れたらテストの意味が変わる）。
    expect(rankSetupRoutes(171, 3).some((route) => route.darts[0].id === 'T16')).toBe(false);

    const result = reviewThrow(record(171, 'T16', 'S16'));
    expect(result.verdict).toBe('GOOD_DECISION');
  });

  it('候補一覧に入っている S / A の 1 投目は、どの残りでも GOOD DECISION', () => {
    const notGood: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      const ranked = rankSetupRoutes(left, 3, { maxRoutes: 100000 });
      const good = ranked.filter((route) => route.grade === 'S' || route.grade === 'A');
      const firstDarts = [...new Set(good.map((route) => route.darts[0].id))];
      for (const id of firstDarts) {
        const verdict = reviewThrow(record(left, id, 'MISS')).verdict;
        if (verdict !== 'GOOD_DECISION') notGood.push(`${left}: ${id} → ${verdict}`);
      }
    }
    expect(notGood).toEqual([]);
  });

  it('SETUP 領域（171〜350）でも、推奨の 1 投目は GOOD DECISION', () => {
    const notGood: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      const intended = recommendedFirstDart(left, 3);
      const result = reviewThrow(record(left, intended, 'MISS'));
      if (result.verdict !== 'GOOD_DECISION') {
        notGood.push(`${left}: ${intended} → ${result.verdict}`);
      }
    }
    expect(notGood).toEqual([]);
  });
});

describe('分類', () => {
  it('351 以上はアレンジ判断の対象外（SCORING）', () => {
    const result = reviewThrow(record(501, 'T20', 'T20'));
    expect(result.verdict).toBe('SCORING_PHASE');
    expect(result.grade).toBeNull();
    expect(result.noteJa).toContain('対象外');
  });

  it('狙い通り入ると Bust する的は ARRANGEMENT MISTAKE', () => {
    const result = reviewThrow(record(40, 'T20', 'S20'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.intendedLeave).toBeNull();
    expect(result.noteJa).toContain('Bust');
  });

  it('残り 1 になる狙いも Bust として指摘する', () => {
    const result = reviewThrow(record(20, 'S19', 'S19'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.noteJa).toContain('残り 1');
  });

  it('ビジット最後の 1 投で Bogey を残す狙いは BOGEY CREATED', () => {
    // 170 から S11 を狙うと 159（3 本あっても上がれない）。
    expect(isBogey(159)).toBe(true);
    const result = reviewThrow(record(170, 'S11', 'S11', 3));
    expect(result.verdict).toBe('BOGEY_CREATED');
    expect(result.intendedLeave).toBe(159);
    expect(result.noteJa).toContain('ノーテン');
  });

  it('ビジット途中で一時的に Bogey を通るのは判断ミスにしない', () => {
    // 219 から T20（推奨）を狙うと一度 159 を通るが、残り 2 本で作り直せる。
    expect(isBogey(159)).toBe(true);
    const result = reviewThrow(record(219, 'T20', 'T20', 1));
    expect(result.intendedLeave).toBe(159);
    expect(result.verdict).toBe('GOOD_DECISION');
  });

  it('CHECKOUT では、候補に無い狙いを ARRANGEMENT MISTAKE と言い切れる', () => {
    /*
     * CHECKOUT のランキングは全ルートの列挙なので、
     * 一覧に無い＝その 1 投目から上がる組み立てが無い、と断定できる。
     * 170 から S11 を狙うと 159 で、残り 2 本では上がれない。
     */
    expect(rankCheckoutRoutes(170, 3).some((route) => route.darts[0].id === 'S11')).toBe(false);
    const result = reviewThrow(record(170, 'S11', 'S11'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.recommendedDartId).not.toBeNull();
    expect(result.noteJa).toContain('上がる組み立てがありません');
  });

  it('成立はするが非推奨（推奨度 C）の狙いも ARRANGEMENT MISTAKE', () => {
    const result = reviewThrow(record(40, 'S3', 'S3'));
    expect(result.verdict).toBe('ARRANGEMENT_MISTAKE');
    expect(result.grade).toBe('C');
    expect(result.noteJa).toContain('非推奨');
  });

  it('SETUP では、候補に無いだけの狙いをミスと言い切らない', () => {
    /*
     * SETUP の候補は承認済みの戦術のふるいを通った一覧で、盤面の全 62 通りを
     * 評価したものではない。「一覧に無い」を不正解の根拠にしない。
     */
    // 243 / 3 本の S1 → 242 は、残り 2 本でテンパイを作れる（計算で悪いと言い切れない）。
    const result = reviewThrow(record(243, 'S1', 'S1'));
    expect(result.verdict).toBe('NOT_EVALUATED');
    expect(result.noteJa).toContain('断定していません');
    // それでも、アプリならどう組み立てたかは示す。
    expect(result.recommendedRouteText).not.toBeNull();
  });

  it('SETUP でも、狙い通りに入ってもテンパイを作れない狙いは SETUP MISTAKE と言い切る', () => {
    /*
     * 301 / 3 本の S1 → 300 は、残り 2 本で何を取っても 3 本で上がれる残りにならない。
     * 候補一覧に無いことではなく、計算した事実を根拠にする（v1.4.3）。
     */
    expect(canReachTenpai(300, 2)).toBe(false);
    const result = reviewThrow(record(301, 'S1', 'S1'));
    expect(result.verdict).toBe('SETUP_MISTAKE');
    expect(result.noteJa).toContain('300');
    expect(result.noteJa).toContain('テンパイ');
    expect(result.noteJa).toContain('T20');
  });

  it('おすすめのルートと 1 投目を必ず添える（判定できる場面では）', () => {
    const result = reviewThrow(record(125, 'S3', 'S3'));
    expect(result.recommendedRouteText).not.toBeNull();
    expect(result.recommendedDartId).not.toBeNull();
    expect(result.noteJa).toContain(result.recommendedRouteText!);
  });

  it('MY ROUTE に沿った狙いを不正解にしない', () => {
    /*
     * 得意ダブルを設定すると MY ROUTE の 1 投目が変わり、かつその 1 投目が
     * 標準ランキングでは S / A ではない場面を探す（設定がなければ
     * GOOD DECISION にならない場面 ＝ 設定でしか救われない場面）。
     */
    const preferredDoubles = ['D10'];
    let found: { left: number; myRoute: string } | null = null;
    for (let left = 2; left <= 170 && found === null; left += 1) {
      const standard = rankCheckoutRoutes(left, 3);
      const my = rankCheckoutRoutes(left, 3, { preferredDoubles, applyStandardBonus: false });
      if (standard.length === 0 || my.length === 0) continue;
      const myFirst = my[0].darts[0].id;
      if (standard[0].darts[0].id === myFirst) continue;
      // 標準ランキングでの、その 1 投目の最良グレード。
      const grades = standard
        .filter((route) => route.darts[0].id === myFirst)
        .map((route) => route.grade);
      if (grades.includes('S') || grades.includes('A')) continue;
      found = { left, myRoute: myFirst };
    }
    expect(found).not.toBeNull();
    const { left, myRoute } = found!;

    // 設定が無ければ GOOD DECISION にはならない。
    expect(reviewThrow(record(left, myRoute, 'S1')).verdict).not.toBe('GOOD_DECISION');
    // 得意ダブルを設定していれば GOOD DECISION。
    const withPreference = reviewThrow(record(left, myRoute, 'S1'), { preferredDoubles });
    expect(withPreference.verdict).toBe('GOOD_DECISION');
    expect(withPreference.noteJa).toContain('MY ROUTE');
  });

  it('NEXT VISIT の残し候補にも得意ダブルが効く', () => {
    /*
     * 回帰テスト（Codex レビュー P2）。
     * suggestFor が NEXT VISIT で読むのは fallbackPreferredDoubles なので、
     * preferredDoubles を渡すだけでは MY ROUTE が無視されていた。
     */
    const withPreference = reviewThrow(record(41, 'S1', 'S1', 3), {
      preferredDoubles: ['D20'],
    });
    expect(withPreference.intendedLeave).toBe(40);
    expect(withPreference.verdict).toBe('GOOD_DECISION');
    expect(withPreference.recommendedRouteText).toContain('S1');
  });
});

describe('残り 1 投で「次のラウンドで上がれる数字」を作れているか', () => {
  /*
   * 添付実例の回帰テスト。
   * LEFT 178 / 残り 1 投 / 狙い T19。
   *
   * T19 を低く評価すること自体は妥当だが、理由が「アプリの第 1 候補
   * （S18 → 160）ではないから」になっていて、T20 / T18 との差
   * ＝ シングルに外れたときにテンパイを保てるか、を説明していなかった。
   */
  it('178 / 残り 1 投の T19 は、シングル落ちで 159 になることを理由に指摘する', () => {
    const result = reviewThrow(record(178, 'T19', 'S19', 3));
    expect(result.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(result.intendedLeave).toBe(121);
    // なぜ劣るのか（シングル落ち → 159 → 次で上がれない）を具体的に書く。
    expect(result.noteJa).toContain('159');
    expect(result.noteJa).toContain('Bogey Number');
    expect(result.noteJa).toContain('Checkout できません');
    // 代わりに狙うべきトリプルを、シングル落ちの残りまで添えて示す。
    expect(result.noteJa).toContain('T20');
    expect(result.noteJa).toContain('T18');
    expect(result.noteJa).toContain('158');
    expect(result.noteJa).toContain('160');
    // 「成立する」と「良い選択」を混同しない。
    expect(result.noteJa).toContain('良い選択ではありません');
  });

  it('178 / 残り 1 投の T20・T18 は GOOD DECISION（正解を 1 つに絞らない）', () => {
    for (const [id, hit, miss] of [
      ['T20', 118, 158],
      ['T18', 124, 160],
    ] as const) {
      const result = reviewThrow(record(178, id, 'S1', 3));
      expect(result.verdict).toBe('GOOD_DECISION');
      expect(result.intendedLeave).toBe(hit);
      expect(result.noteJa).toContain(String(miss));
    }
  });

  it('160 を作る狙いだけを特別扱いしない', () => {
    // 160 を作れても、シングル落ちでテンパイを外す狙いは GOOD にしない。
    // 178 の T6 は 160 を残すが、S6 へ落ちると 172 で次に上がれない。
    const triple = reviewThrow(record(178, 'T6', 'S6', 3));
    expect(triple.intendedLeave).toBe(160);
    expect(triple.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(triple.noteJa).toContain('172');

    // 160 を残す S18 も、同じナンバーのトリプルが上位互換なら GOOD にしない
    // （下の「同じナンバーのトリプルが上位互換」の節を参照）。
    expect(reviewThrow(record(178, 'S18', 'S18', 3)).verdict).toBe('BETTER_OPTION_AVAILABLE');
  });

  it('181〜189 / 残り 1 投で、テンパイを作れるかを評価軸にする', () => {
    /*
     * この帯はシングルへ落ちると 159〜169（Bogey が並ぶ帯）へ入りやすく、
     * 「トリプルに入ればより良い残り・シングルでもテンパイ」を選べるかが
     * そのまま次のラウンドの Checkout 機会になる。
     */
    const wrong: string[] = [];
    for (let left = 181; left <= 189; left += 1) {
      const analysis = analyzeLastDartSetup(left);
      expect(analysis.safeTripleTargets.length).toBeGreaterThan(0);

      for (const option of analysis.safeTripleTargets) {
        const verdict = reviewThrow(record(left, option.dartId, 'MISS', 3)).verdict;
        if (verdict !== 'GOOD_DECISION') wrong.push(`${left}: ${option.dartId} → ${verdict}`);
      }

      // シングル落ちでテンパイを外すトリプルは、GOOD DECISION にしない。
      const unsafe = analysis.tenpaiTargets.filter(
        (option) => option.dart.kind === 'triple' && !option.singleMissTenpai,
      );
      for (const option of unsafe) {
        const verdict = reviewThrow(record(left, option.dartId, 'MISS', 3)).verdict;
        if (verdict !== 'BETTER_OPTION_AVAILABLE') {
          wrong.push(`${left}: ${option.dartId}（危険）→ ${verdict}`);
        }
      }

      // テンパイを作れない狙いは、はっきり指摘する。
      const dead = analysis.optionFor('S1');
      if (dead !== null && !dead.hitTenpai) {
        const verdict = reviewThrow(record(left, 'S1', 'S1', 3)).verdict;
        if (verdict !== 'SETUP_MISTAKE' && verdict !== 'BOGEY_CREATED') {
          wrong.push(`${left}: S1 → ${verdict}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('171〜350 のどこでも、シングル落ちまで安全なトリプルを MISTAKE 扱いしない', () => {
    const wrong: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      for (const option of analyzeLastDartSetup(left).safeTripleTargets) {
        const verdict = reviewThrow(record(left, option.dartId, 'MISS', 3)).verdict;
        if (verdict !== 'GOOD_DECISION') wrong.push(`${left}: ${option.dartId} → ${verdict}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('残り 1 投で Bogey を作る狙いは、理由まで含めて辛口に指摘する', () => {
    const result = reviewThrow(record(178, 'S19', 'S19', 3));
    expect(result.verdict).toBe('BOGEY_CREATED');
    expect(result.intendedLeave).toBe(159);
    expect(result.noteJa).toContain('Bogey Number');
    expect(result.noteJa).toContain('ノーテン');
    // 次にどう考えるかまで書く。
    expect(result.noteJa).toContain('シングルに外れても');
  });

  it('残り 1 投でテンパイを作れない狙いは SETUP MISTAKE と言い切る', () => {
    const result = reviewThrow(record(178, 'S1', 'S1', 3));
    expect(result.verdict).toBe('SETUP_MISTAKE');
    expect(result.intendedLeave).toBe(177);
    expect(result.noteJa).toContain('テンパイを作れません');
    expect(result.noteJa).toContain('T20');
  });

  it('シングル落ちまで守れる的が無い残り点では、無い条件を理由に減点しない', () => {
    /*
     * 191 以上ではどのシングルへ落ちても 171 以上になり、
     * 「シングルに外れてもテンパイ」を満たす的が存在しない。
     * そこで狙い通りテンパイを作れる狙いは GOOD DECISION のままにする。
     */
    const analysis = analyzeLastDartSetup(191);
    expect(analysis.hasTenpaiTargets).toBe(true);
    expect(analysis.safeTargets).toEqual([]);

    const good = reviewThrow(record(191, 'T20', 'S20', 3));
    expect(good.verdict).toBe('GOOD_DECISION');
    expect(good.noteJa).toContain('保てるターゲットがありません');

    // それでも、テンパイを作れない狙いははっきり指摘する。
    const bad = reviewThrow(record(191, 'S1', 'S1', 3));
    expect(bad.verdict).toBe('SETUP_MISTAKE');
    expect(bad.noteJa).toContain('T20');
    // 存在しない条件（シングルに外れても…）を勧めない。
    expect(bad.noteJa).not.toContain('シングルに外れても');
  });

  it('190 では、160 を残す T10 より「シングルでも 170」の T20 を上に見る', () => {
    /*
     * 2〜350 のうち、この軸がエンジンの第 1 候補と食い違う唯一の残り点。
     * T10 → 160（S10 へ落ちると 180）より、T20 → 130（S20 でも 170）を優先する。
     */
    const t10 = reviewThrow(record(190, 'T10', 'S10', 3));
    expect(t10.intendedLeave).toBe(160);
    expect(t10.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(t10.noteJa).toContain('180');

    const t20 = reviewThrow(record(190, 'T20', 'S20', 3));
    expect(t20.verdict).toBe('GOOD_DECISION');
    expect(t20.noteJa).toContain('170');
  });

  it('この判定も、狙いだけで決まる（着弾は見ない）', () => {
    const onTarget = reviewThrow(record(178, 'T19', 'T19', 3));
    const wayOff = reviewThrow(record(178, 'T19', 'S5', 3));
    const outBoard = reviewThrow(record(178, 'T19', 'MISS', 3));
    expect(wayOff.verdict).toBe(onTarget.verdict);
    expect(outBoard.verdict).toBe(onTarget.verdict);
    expect(wayOff.noteJa).toBe(onTarget.noteJa);
    expect(outBoard.noteJa).toBe(onTarget.noteJa);
  });

  it('同じナンバーのトリプルが上位互換なら、シングル直接狙いは GOOD にしない', () => {
    /*
     * S18 で 160 を残すのと、T18 を狙って S18 へ落ちて 160 を残すのは、
     * 外したときの残りが同じ。そのうえ T18 に入れば 124 まで進める。
     * 守りが同じで当たれば前進するので、トリプルを狙う方が実戦的。
     */
    const result = reviewThrow(record(178, 'S18', 'S18', 3));
    expect(result.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(result.intendedLeave).toBe(160);
    expect(result.noteJa).toContain('テンパイは作れますが');
    expect(result.noteJa).toContain('T18');
    expect(result.noteJa).toContain('160');
    expect(result.noteJa).toContain('124');
    // 悪手扱いにはしない。
    expect(result.verdict).not.toBe('SETUP_MISTAKE');
  });

  it('S20 → 158 のような同種のケースも同じ扱いになる', () => {
    const result = reviewThrow(record(178, 'S20', 'S20', 3));
    expect(result.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(result.intendedLeave).toBe(158);
    expect(result.noteJa).toContain('T20');
    expect(result.noteJa).toContain('158');
    expect(result.noteJa).toContain('118');
  });

  it('同じナンバーのトリプルが上位互換でなければ、シングル直接狙いは GOOD のまま', () => {
    /*
     * 171 の S4 は 167 を残してテンパイ。T4 を狙うと 159（Bogey）なので、
     * トリプルは上位互換ではない。シングル狙いを一律で下げない。
     */
    const analysis = analyzeLastDartSetup(171);
    expect(analysis.optionFor('T4')!.hitTenpai).toBe(false);
    expect(isBogey(analysis.optionFor('T4')!.leaveOnHit)).toBe(true);

    const result = reviewThrow(record(171, 'S4', 'S4', 3));
    expect(result.verdict).toBe('GOOD_DECISION');
    expect(result.intendedLeave).toBe(167);
  });

  it('BETTER になるのは「同じナンバーのトリプルが上位互換」のときだけ（171〜350 全件）', () => {
    /*
     * 上位互換の条件は 2 つだけ。
     *   1. トリプルに入っても 3 本で上がれる（Bust もしない）
     *   2. シングルへ落ちてもテンパイを保てる（＝シングル直接狙いと同じ残り）
     * 特定の残り点（160 / 170 など）は条件に入れない。
     */
    const wrong: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      const analysis = analyzeLastDartSetup(left);
      for (const option of analysis.safeTargets) {
        if (option.dart.kind !== 'single') continue;
        const triple = analysis.optionFor(`T${option.dart.baseNumber}`);
        const upgrade =
          triple !== null &&
          triple.hitTenpai &&
          triple.singleMissTenpai &&
          triple.leaveOnSingleMiss === option.leaveOnHit;
        const expected = upgrade ? 'BETTER_OPTION_AVAILABLE' : 'GOOD_DECISION';
        const verdict = reviewThrow(record(left, option.dartId, 'MISS', 3)).verdict;
        if (verdict !== expected) {
          wrong.push(`${left}: ${option.dartId} → ${verdict}（期待 ${expected}）`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('CHECKOUT 帯（170 以下）の残しには、この上位互換の判定を持ち込まない', () => {
    /*
     * 170 以下は承認済みの NEXT VISIT セレクタが残しを選ぶ場面で、
     * 「残りが小さいほど良い」とは限らない（残り 41 の S1 → 40 は D20 で
     * 上がれる残りで、T1 → 38 が上位互換とは言えない）。
     */
    const analysis = analyzeLastDartSetup(41);
    const triple = analysis.optionFor('T1')!;
    expect([triple.hitTenpai, triple.singleMissTenpai]).toEqual([true, true]);

    const result = reviewThrow(record(41, 'S1', 'S1', 3));
    expect(result.verdict).toBe('GOOD_DECISION');
    expect(result.intendedLeave).toBe(40);
  });

  it('181〜189 のシングル落ち耐性の判定は変わらない', () => {
    const wrong: string[] = [];
    for (let left = 181; left <= 189; left += 1) {
      for (const option of analyzeLastDartSetup(left).safeTripleTargets) {
        const verdict = reviewThrow(record(left, option.dartId, 'MISS', 3)).verdict;
        if (verdict !== 'GOOD_DECISION') wrong.push(`${left}: ${option.dartId} → ${verdict}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('1 投目・2 投目にはこの軸を持ち込まない（作り直せるため）', () => {
    // 178 の 1 投目に T19 を狙うのは、残り 2 本あるので別の判断。
    const first = reviewThrow(record(178, 'T19', 'S19', 1));
    expect(first.verdict).not.toBe('BETTER_OPTION_AVAILABLE');
    expect(first.noteJa).not.toContain('シングルに外れると');
  });
});

describe('SETUP 中・残り 2 本以上: シングル落ち後もテンパイを作れるか（v1.4.3）', () => {
  /*
   * 添付実例 A: ビジット開始 261 → 1 投目 S18 → 残り 243 / 残り 2 本。
   * T20 は「候補一覧に無い」という理由で判定対象外になっていた。
   */
  it('243 / 残り 2 本の T20 は、判定対象外ではなく BETTER OPTION AVAILABLE', () => {
    const result = reviewThrow(record(243, 'T20', 'S20', 2));
    expect(result.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(result.verdict).not.toBe('NOT_EVALUATED');
    expect(result.intendedLeave).toBe(183);
    // 狙い通りなら成立すること。
    expect(result.noteJa).toContain('183');
    // S20 に落ちると 223 で、最後の 1 本ではテンパイを作れないこと。
    expect(result.noteJa).toContain('S20 に落ちると残り 223');
    expect(result.noteJa).toContain('最後の 1 本では');
    expect(result.noteJa).toContain('作れません');
    // T19 なら S19 に落ちても 224 で、T20 → 164・T19 → 167・T18 → 170 などが残ること。
    expect(result.noteJa).toContain('T19 なら S19 に落ちても残り 224');
    expect(result.noteJa).toContain('T20 → 164');
    expect(result.noteJa).toContain('T19 → 167');
    expect(result.noteJa).toContain('T18 → 170');
    // 悪手とまでは言わない。
    expect(result.noteJa).not.toContain('不適切');
  });

  it('243 / 残り 2 本の T19 は GOOD DECISION（S19 へ落ちても 224 からテンパイを作れる）', () => {
    const t19 = requireDart('T19');
    expect(canReachTenpai(243 - 57, 1)).toBe(true);
    expect(isSingleMissTenpaiSafe(243, t19, 2)).toBe(true);
    // 224 から最後の 1 本で作れるテンパイ（T19 を続けて狙うことは条件にしない）。
    expect([224 - 60, 224 - 57, 224 - 54]).toEqual([164, 167, 170]);

    const result = reviewThrow(record(243, 'T19', 'S19', 2));
    expect(result.verdict).toBe('GOOD_DECISION');
  });

  it('T20 → S20 で詰む 7 点は、どれも一般計算から別トリプルを示す（特例表を持たない）', () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [239, 'T19'],
      [242, 'T18'],
      [243, 'T19'],
      [245, 'T18'],
      [246, 'T19'],
      [248, 'T18'],
      [249, 'T19'],
    ];
    const t20 = requireDart('T20');
    const wrong: string[] = [];
    for (const [left, safeId] of cases) {
      const safe = requireDart(safeId);
      // 前提: T20 は狙い通りならテンパイへ進めるが、S20 へ落ちると 1 本では作れない。
      if (!canReachTenpai(left - 60, 1)) wrong.push(`${left}: T20 狙い通りで作れない`);
      if (isSingleMissTenpaiSafe(left, t20, 2)) wrong.push(`${left}: T20 がシングル落ちでも安全`);
      // 示すトリプルは、狙い通り・シングル落ちの両方でテンパイへ進める。
      if (!canReachTenpai(left - safe.score, 1)) wrong.push(`${left}: ${safeId} 狙い通りで作れない`);
      if (!isSingleMissTenpaiSafe(left, safe, 2)) wrong.push(`${left}: ${safeId} が安全でない`);

      const result = reviewThrow(record(left, 'T20', 'S20', 2));
      if (result.verdict !== 'BETTER_OPTION_AVAILABLE') wrong.push(`${left}: ${result.verdict}`);
      if (!result.noteJa.includes(`残り ${left - 20}`)) wrong.push(`${left}: S20 の残りが無い`);
      if (!result.noteJa.includes(`${safeId} なら`)) wrong.push(`${left}: ${safeId} を示していない`);
    }
    expect(wrong).toEqual([]);
  });

  it('候補一覧に無いトリプルは、A / B の事実だけで判定する（171〜350・残り 2 本 / 3 本の全件）', () => {
    /*
     * A = 狙い通りならテンパイへ進める / B = 同ナンバーのシングルへ落ちても進める。
     *   A かつ B でない（B を満たす的が他にある） → BETTER OPTION AVAILABLE
     *   A でない（A を満たす的が他にある）       → SETUP MISTAKE
     * 推奨度が付いている狙い（候補一覧にある狙い）は従来どおり推奨度で判定する。
     */
    const triples = THROWABLE_DARTS.filter((dart) => dart.kind === 'triple');
    const wrong: string[] = [];
    for (let left = 171; left <= 350; left += 1) {
      for (const dartsLeft of [2, 3]) {
        const facts = triples.map((dart) => ({
          dart,
          hit: canReachTenpai(left - dart.score, dartsLeft - 1),
          safe: isSingleMissTenpaiSafe(left, dart, dartsLeft),
        }));
        for (const item of facts) {
          const result = reviewThrow(record(left, item.dart.id, 'MISS', 4 - dartsLeft));
          if (result.grade !== null) continue;
          const othersHit = facts.some((other) => other !== item && other.hit);
          const othersSafe = facts.some((other) => other !== item && other.hit && other.safe);
          if (!item.hit && othersHit && result.verdict !== 'SETUP_MISTAKE') {
            wrong.push(`${left}/${dartsLeft} ${item.dart.id}: ${result.verdict}（期待 SETUP_MISTAKE）`);
          }
          if (item.hit && !item.safe && othersSafe && result.verdict !== 'BETTER_OPTION_AVAILABLE') {
            wrong.push(`${left}/${dartsLeft} ${item.dart.id}: ${result.verdict}（期待 BETTER）`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('1 投目・2 投目の SETUP でも、推奨度の付いた狙いの判定は変えない', () => {
    // 候補一覧にある S / A の 1 投目は GOOD のまま（既存テストの前提を確認）。
    expect(reviewThrow(record(243, 'T19', 'S19', 2)).grade).toBe('S');
    expect(reviewThrow(record(301, 'T20', 'T20', 1)).verdict).toBe('GOOD_DECISION');
  });
});

describe('ビジット最後の 1 投: 次のビジットでダブルへ到達するまでに何が要るか（v1.4.3）', () => {
  /*
   * 添付実例 B: 残り 116 / 残り 1 本。
   * S16 → 100 を「良い判断」とし、説明では T20 / T19 の方が良いと示唆していた。
   */
  it('116 / 残り 1 本の S16 は BETTER OPTION AVAILABLE', () => {
    const result = reviewThrow(record(116, 'S16', 'S16', 3));
    expect(result.verdict).toBe('BETTER_OPTION_AVAILABLE');
    expect(result.intendedLeave).toBe(100);
    // 100 は Checkout 可能だと認めたうえで、T20 / T19 の方が実戦的だと示す。
    expect(result.noteJa).toContain('残り 100');
    expect(result.noteJa).toContain('Checkout はできます');
    expect(result.noteJa).toContain('実戦的');
    expect(result.noteJa).toContain('T20 なら狙い通り 56');
    expect(result.noteJa).toContain('S20 に落ちても 96');
    expect(result.noteJa).toContain('T19');
    expect(result.verdict).not.toBe('SETUP_MISTAKE');
  });

  it('116 / 残り 1 本の T20・T19 は GOOD DECISION', () => {
    for (const id of ['T20', 'T19']) {
      expect(reviewThrow(record(116, id, 'MISS', 3)).verdict).toBe('GOOD_DECISION');
    }
    // GOOD の説明では、上位互換を取られている T18（狙い通り 62）を「同じ条件」と勧めない。
    expect(reviewThrow(record(116, 'T20', 'MISS', 3)).noteJa).not.toContain('T18');
  });

  it('残りが小さいだけの的を上に見ない（116 の T16 → 68 は S16 → 100 の上位互換ではない）', () => {
    const t16 = { hit: nextVisitLeaveProfileOf(68), miss: nextVisitLeaveProfileOf(100) };
    const s16 = { hit: nextVisitLeaveProfileOf(100), miss: nextVisitLeaveProfileOf(100) };
    expect(nextVisitLeaveProfileOf(68).rank).toBe(nextVisitLeaveProfileOf(100).rank);
    expect(dominatesLeavePair(t16, s16)).toBe(false);
  });

  it('41 の S1 → 40 は GOOD のまま（T1 → 38 は上位互換ではない）', () => {
    expect(reviewThrow(record(41, 'S1', 'S1', 3)).verdict).toBe('GOOD_DECISION');
  });

  it('得意ダブル（MY ROUTE）で NEXT VISIT の第 1 候補が変わった狙いは下げない', () => {
    // 得意ダブル D20 なら、残り 73 / 1 本の NEXT VISIT 第 1 候補は T11 → 40。
    const preferredDoubles = ['D20'];
    const proposal = suggestFor(73, 1, { fallbackPreferredDoubles: preferredDoubles })
      .nextVisitProposals[0];
    expect(proposal.route.darts[0].id).toBe('T11');
    expect(proposal.route.leave).toBe(40);

    expect(reviewThrow(record(73, 'T11', 'T11', 3), { preferredDoubles }).verdict).toBe(
      'GOOD_DECISION',
    );
    // 設定が無ければ、S11 へ落ちた 62（先にトリプルが要る）の弱さを指摘する。
    expect(reviewThrow(record(73, 'T11', 'T11', 3)).verdict).toBe('BETTER_OPTION_AVAILABLE');
  });

  it('2〜170 / 残り 1 本: GOOD の狙いは、どの的にも上位互換を取られていない（全件）', () => {
    const wrong: string[] = [];
    const noGood: number[] = [];
    for (let left = 2; left <= 170; left += 1) {
      const analysis = analyzeLastDartSetup(left);
      const candidates = analysis.tenpaiTargets.filter(
        (option) => option.leaveOnSingleMiss !== null && option.dart.kind !== 'double',
      );
      if (candidates.length === 0) continue;
      const pairOf = (option: (typeof candidates)[number]) => ({
        hit: nextVisitLeaveProfileOf(option.leaveOnHit),
        miss: nextVisitLeaveProfileOf(option.leaveOnSingleMiss!),
      });
      let goods = 0;
      for (const option of candidates) {
        const verdict = reviewThrow(record(left, option.dartId, 'MISS', 3)).verdict;
        if (verdict !== 'GOOD_DECISION') continue;
        goods += 1;
        const by = candidates.find(
          (other) => other !== option && dominatesLeavePair(pairOf(other), pairOf(option)),
        );
        if (by !== undefined) wrong.push(`${left}: ${option.dartId} は ${by.dartId} に上位互換を取られている`);
      }
      // 上位互換の比較だけで、その場面の GOOD を 0 件にしない。
      if (goods === 0 && suggestFor(left, 1).checkoutRoutes.length === 0) noGood.push(left);
    }
    expect(wrong).toEqual([]);
    expect(noGood).toEqual([]);
  });
});

describe('GAME REVIEW の集計', () => {
  it('9 ダーツで上がった完全プレイを正しく要約する', () => {
    // 501 = T20×3 → 321 = T20×3 → 141 = T20 + T19 + D12
    let game = createGame(PERFECT, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    game = throwMany(game, ['segment-t20', 'segment-t19', 'segment-d12']);
    game = advanceRound(submitScore(game, 141));

    expect(game.phase).toBe('finished');
    const review = buildGameReview(game);
    expect(review.summary.startScore).toBe(501);
    expect(review.summary.totalDarts).toBe(9);
    expect(review.summary.ppr).toBeCloseTo(MAX_PPR, 6);
    expect(review.summary.first9Ppr).toBeCloseTo(MAX_PPR, 6);
    expect(review.summary.calculationMissCount).toBe(0);
    expect(review.summary.bustCount).toBe(0);
    expect(review.summary.checkedOut).toBe(true);
    expect(review.summary.checkoutDarts).toBe(3);
    expect(review.summary.checkoutScore).toBe(141);
    expect(review.rounds).toHaveLength(3);
    expect(review.rounds[2].throws).toHaveLength(3);
  });

  it('BUST したラウンドは 0 点として PPR に効く', () => {
    let game = createGame({ ...PERFECT, startScore: 100 }, 1);
    // 1 ラウンド目: T20 → 40、T20 で BUST。
    game = throwMany(game, ['segment-t20', 'segment-t20']);
    game = advanceRound(game);
    expect(game.left).toBe(100);
    // 2 ラウンド目: T20 → 40、D20 で上がり。
    game = throwMany(game, ['segment-t20', 'segment-d20']);
    game = advanceRound(submitScore(game, 100));

    const review = buildGameReview(game);
    expect(review.summary.bustCount).toBe(1);
    expect(review.summary.totalDarts).toBe(4);
    // 100 点を 4 本で消化 → 100 / 4 × 3 = 75。
    expect(review.summary.ppr).toBeCloseTo(75, 6);
    expect(review.rounds[0].scored).toBe(0);
  });

  it('CALCULATION MISS の回数を数え、そのラウンドへ印を残す', () => {
    let game = createGame({ ...PERFECT, startScore: 180 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-s20-outer']);
    // 間違えても進めない。正解するまで入力を求める。
    game = submitScore(game, 145); // 正しくは 140
    expect(advanceRound(game)).toBe(game);
    game = advanceRound(submitScore(game, 140));

    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));

    const review = buildGameReview(game);
    expect(review.summary.calculationMissCount).toBe(1);
    expect(review.rounds[0].entry).toEqual({
      entered: 140,
      actual: 140,
      miss: true,
      wrongEntries: [145],
    });
    expect(review.summary.checkoutDarts).toBe(1);
    expect(review.summary.checkoutScore).toBe(40);
  });

  it('同じラウンドで複数回間違えたら、その回数だけ数える', () => {
    let game = createGame({ ...PERFECT, startScore: 180 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-s20-outer']);
    game = submitScore(game, 145);
    game = submitScore(game, 130);
    game = advanceRound(submitScore(game, 140));
    game = throwMany(game, ['segment-d20']);
    game = advanceRound(submitScore(game, 40));

    const review = buildGameReview(game);
    expect(review.summary.calculationMissCount).toBe(2);
    expect(review.rounds[0].entry?.wrongEntries).toEqual([145, 130]);
  });

  it('分類ごとの件数を数える', () => {
    let game = createGame({ ...PERFECT, startScore: 170 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-inner-bull']);
    game = advanceRound(submitScore(game, 170));

    const review = buildGameReview(game);
    const total = Object.values(review.verdictCounts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(3);
    expect(review.verdictCounts.GOOD_DECISION).toBeGreaterThan(0);
  });

  it('上がっていないゲームでも要約を作れる', () => {
    let game = createGame({ ...PERFECT, startScore: 501 }, 1);
    game = throwMany(game, ['segment-t20', 'segment-t20', 'segment-t20']);
    game = advanceRound(submitScore(game, 180));
    const review = buildGameReview(game);
    expect(review.summary.checkedOut).toBe(false);
    expect(review.summary.checkoutDarts).toBeNull();
    expect(review.summary.checkoutScore).toBeNull();
    expect(review.summary.totalDarts).toBe(3);
  });
});

describe('判断の分類の画面表記', () => {
  it('7 分類すべてに日本語の表記と補足がある（英語の見出しを残さない）', () => {
    for (const verdict of THROW_VERDICTS) {
      expect(THROW_VERDICT_JA[verdict]).not.toMatch(/[A-Z]{3,}/);
      expect(THROW_VERDICT_JA[verdict].length).toBeGreaterThan(0);
      expect(THROW_VERDICT_HINT_JA[verdict].length).toBeGreaterThan(0);
    }
    // 表記が重なると内訳の件数を取り違える。
    expect(new Set(THROW_VERDICTS.map((verdict) => THROW_VERDICT_JA[verdict])).size).toBe(
      THROW_VERDICTS.length,
    );
    expect(THROW_VERDICT_JA.NOT_EVALUATED).toBe('判定対象外');
  });
});

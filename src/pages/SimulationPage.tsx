import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dartboard, type BoardMarker } from '../components/Dartboard';
import { StatusBar } from '../components/StatusBar';
import { toDisplayPoint } from '../engine/simulation/boardGeometry';
import {
  MAX_PPR,
  type MaxMissLevel,
  type MissDirection,
} from '../engine/simulation/accuracy';
import {
  MAX_START_SCORE,
  MIN_START_SCORE,
  PRESET_START_SCORES,
  advanceRound,
  canUndo,
  createGame,
  dartsLeftInRound,
  describeThrow,
  hasWrongEntry,
  needsScoreEntry,
  submitScore,
  throwAt,
  totalDarts,
  undoLastThrow,
  type SimulationGame,
  type ThrowRecord,
} from '../engine/simulation/game';
import { createGameSeed } from '../engine/simulation/throwSimulator';
import {
  THROW_VERDICT_JA,
  buildGameReview,
  type ThrowVerdict,
} from '../engine/simulation/review';
import {
  loadSimulationPreferences,
  saveSimulationPreferences,
  type SimulationPreferences,
} from '../storage/simulationSettings';
import { usePreferences } from '../hooks/usePreferences';
import './SimulationPage.css';

const DIRECTION_LABELS: ReadonlyArray<{ value: MissDirection; label: string; hint: string }> = [
  { value: 'vertical', label: '縦ブレ', hint: '上下に散りやすい' },
  { value: 'horizontal', label: '横ブレ', hint: '左右に散りやすい' },
  { value: 'even', label: '均等', hint: '方向のかたよりなし' },
];

const MAX_MISS_LABELS: ReadonlyArray<{ value: MaxMissLevel; label: string; hint: string }> = [
  { value: 'small', label: '小', hint: '大きく外しても隣の区画あたり' },
  { value: 'medium', label: '中', hint: 'たまに隣のナンバーを越える' },
  { value: 'large', label: '大', hint: 'まれに大きく外し、盤外もある' },
];

/** 判断の分類ごとの見た目（既存の推奨度バッジと同じ配色体系に合わせる）。 */
const VERDICT_TONE: Readonly<Record<ThrowVerdict, 'good' | 'warn' | 'bad' | 'plain'>> = {
  GOOD_DECISION: 'good',
  BETTER_OPTION_AVAILABLE: 'warn',
  ARRANGEMENT_MISTAKE: 'bad',
  SETUP_MISTAKE: 'bad',
  BOGEY_CREATED: 'bad',
  SCORING_PHASE: 'plain',
  NOT_EVALUATED: 'plain',
};

type StartMode = 'preset' | 'custom';

function pprLabel(value: number): string {
  return value.toFixed(0);
}

export function SimulationPage() {
  const { preferences } = usePreferences();
  const [form, setForm] = useState<SimulationPreferences>(() => loadSimulationPreferences());
  const [startMode, setStartMode] = useState<StartMode>(() =>
    PRESET_START_SCORES.includes(loadSimulationPreferences().startScore) ? 'preset' : 'custom',
  );
  const [customDraft, setCustomDraft] = useState(() =>
    String(loadSimulationPreferences().startScore),
  );
  const [game, setGame] = useState<SimulationGame | null>(null);
  const [scoreDraft, setScoreDraft] = useState('');

  // 設定は入力のたびに端末へ保存し、次回の SIMULATION へ引き継ぐ。
  useEffect(() => {
    saveSimulationPreferences(form);
  }, [form]);

  const start = useCallback(() => {
    setGame(
      createGame(
        {
          startScore: form.startScore,
          first9Ppr: form.first9Ppr,
          averagePpr: form.averagePpr,
          missDirection: form.missDirection,
          maxMiss: form.maxMiss,
        },
        createGameSeed(),
      ),
    );
    setScoreDraft('');
  }, [form]);

  const round = game?.current ?? null;
  const entry = round?.entry ?? null;
  const awaitingEntry = game?.phase === 'score-entry' && needsScoreEntry(round);
  const wrongEntry = hasWrongEntry(round);
  /** 「次のラウンドへ」を出す状態（Enter でも進めるようにフォーカスする）。 */
  const readyForNext = game?.phase === 'score-entry' && round !== null && !needsScoreEntry(round);

  /*
   * 画面上部の LEFT は **ビジット開始時の残りで固定**する。
   *
   * 投げるたびに減らすと、残り点の暗算をアプリが肩代わりしてしまう。
   * 残りを自分で数えるところまでが SIMULATION の練習なので、表示は
   * 「次のビジットへ進んだとき」だけ新しい値へ変える。
   *
   * これは **表示だけ**の仕様。内部の残り（`ThrowRecord.leftAfter` /
   * `currentLeft`）は従来どおり 1 投ごとに更新していて、BUST・Checkout・
   * Double Out・履歴・GAME REVIEW はすべてそちらを見ている。
   */
  const displayLeft = game === null ? form.startScore : (round?.leftBefore ?? game.left);

  const markers = useMemo<readonly BoardMarker[]>(() => {
    if (round === null || round.throws.length === 0) return [];
    const list: BoardMarker[] = [];
    round.throws.forEach((record, index) => {
      const isLast = index === round.throws.length - 1;
      const hit = toDisplayPoint(record.actualPoint);
      if (isLast) {
        const aim = toDisplayPoint(record.intendedPoint);
        const described = describeThrow(record);
        list.push({
          id: `aim-${record.dartIndex}`,
          x: aim.x,
          y: aim.y,
          kind: 'aim',
          label: `狙い ${described.intended}`,
        });
        list.push({
          id: `hit-${record.dartIndex}`,
          x: hit.x,
          y: hit.y,
          kind: 'hit',
          label: `着弾 ${described.actual}`,
        });
        return;
      }
      list.push({ id: `hit-${record.dartIndex}`, x: hit.x, y: hit.y, kind: 'past' });
    });
    return list;
  }, [round]);

  const review = useMemo(() => {
    if (game === null || game.phase !== 'finished') return null;
    return buildGameReview(game, {
      preferredDoubles: preferences.preferredDoubles,
      mainTarget: preferences.setupMainTarget,
    });
  }, [game, preferences.preferredDoubles, preferences.setupMainTarget]);

  /*
   * 3 投目が確定した瞬間に、得点入力欄へ自動でフォーカスする。
   *
   * - PC: そのまま数字キーを打って Enter で確定できる（欄を押す必要がない）。
   * - スマホ / タブレット: `inputMode="numeric"` の欄にフォーカスが移るので、
   *   数字キーボードがそのまま開く。
   *
   * `useLayoutEffect` を使うのは、盤面のタップという **ユーザー操作と同じ処理の
   * 流れの中で** focus を呼ぶため。描画が終わったあとの非同期処理から呼ぶと、
   * iOS Safari はソフトウェアキーボードを開いてくれない。
   *
   * `preventScroll` を付けて、フォーカスによる自動スクロールで盤面が飛ぶのを
   * 防ぐ。そのうえで入力欄が画面外にあるときだけ `block: 'nearest'` で最小限
   * 動かす（見えているときは何も起きない）。スマホでキーボードが せり上がる
   * ぶんの調整は、ブラウザ側が従来どおり面倒を見る。
   */
  const scoreInputRef = useRef<HTMLInputElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const entryRef = useRef<HTMLElement>(null);

  /** 間違えた回数。ここが増えたら入力欄へフォーカスを戻す。 */
  const wrongCount = round?.wrongEntries.length ?? 0;

  useLayoutEffect(() => {
    if (!awaitingEntry) return;
    const input = scoreInputRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    entryRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [awaitingEntry, wrongCount]);

  /*
   * 「次のラウンドへ」もキーボードだけで進めるようにする。
   * ボタンへフォーカスを当てておけば、Enter / Space がそのまま押下になる
   * （独自のキー処理を足さずに済み、読み上げの操作とも食い違わない）。
   */
  useLayoutEffect(() => {
    if (!readyForNext) return;
    nextButtonRef.current?.focus({ preventScroll: true });
    entryRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [readyForNext]);

  const handleSubmitScore = () => {
    if (game === null) return;
    const parsed = Number(scoreDraft.trim());
    if (!/^\d+$/.test(scoreDraft.trim()) || !Number.isInteger(parsed)) return;
    setGame(submitScore(game, parsed));
    // 間違っていたら打ち直してもらうので、いずれにせよ欄は空にする。
    setScoreDraft('');
  };

  const next = () => {
    if (game === null) return;
    setGame(advanceRound(game));
    setScoreDraft('');
  };

  return (
    <div className="simulation">
      {game === null && (
        <section className="simulation__settings" aria-label="SIMULATION の設定">
          <p className="simulation__lead">
            301 / 501 / 701 を、1 投ずつ自分で狙って上がりきるモードです。
            ゲーム中はアレンジの答えを一切出しません。3 投ごとの得点も自分で暗算して入力します。
            終わってから、狙いの良し悪しをまとめて振り返ります。
          </p>

          <fieldset className="simulation__field">
            <legend>開始点数</legend>
            <div className="simulation__choices">
              {PRESET_START_SCORES.map((score) => (
                <button
                  key={score}
                  type="button"
                  data-testid={`sim-start-${score}`}
                  aria-pressed={startMode === 'preset' && form.startScore === score}
                  onClick={() => {
                    setStartMode('preset');
                    setForm((value) => ({ ...value, startScore: score }));
                    setCustomDraft(String(score));
                  }}
                >
                  {score}
                </button>
              ))}
              <button
                type="button"
                data-testid="sim-start-custom"
                aria-pressed={startMode === 'custom'}
                onClick={() => setStartMode('custom')}
              >
                CUSTOM
              </button>
            </div>
            {startMode === 'custom' && (
              <label className="simulation__custom">
                <span>任意の開始点数（{MIN_START_SCORE}〜{MAX_START_SCORE}）</span>
                {/*
                  入力途中の値をそのまま持つ（1 文字ごとに丸めない）。
                  打っている最中に "1" を下限の "2" へ丸めてしまうと、
                  そこから先の桁がすべてずれる。範囲へ収めるのは入力を終えたとき。
                */}
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoComplete="off"
                  data-testid="sim-start-custom-input"
                  value={customDraft}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/\D/g, '').slice(0, 4);
                    setCustomDraft(raw);
                    const parsed = Number(raw);
                    if (raw !== '' && parsed >= MIN_START_SCORE && parsed <= MAX_START_SCORE) {
                      setForm((value) => ({ ...value, startScore: parsed }));
                    }
                  }}
                  onBlur={() => setCustomDraft(String(form.startScore))}
                />
              </label>
            )}
          </fieldset>

          <fieldset className="simulation__field">
            <legend>プレイヤー能力（501 基準の実戦 PPR）</legend>
            <label className="simulation__slider">
              <span>
                FIRST 9 PPR
                <strong data-testid="sim-first9-value">{pprLabel(form.first9Ppr)}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={MAX_PPR}
                step={1}
                data-testid="sim-first9"
                value={form.first9Ppr}
                onChange={(event) =>
                  setForm((value) => ({ ...value, first9Ppr: Number(event.target.value) }))
                }
              />
            </label>
            <label className="simulation__slider">
              <span>
                AVERAGE PPR
                <strong data-testid="sim-average-value">{pprLabel(form.averagePpr)}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={MAX_PPR}
                step={1}
                data-testid="sim-average"
                value={form.averagePpr}
                onChange={(event) =>
                  setForm((value) => ({ ...value, averagePpr: Number(event.target.value) }))
                }
              />
            </label>
            <p className="simulation__hint">
              501 を 9 ダーツで上がると 501 ÷ 9 × 3 = {MAX_PPR} なので、上限は {MAX_PPR} です。
              AVERAGE を {MAX_PPR} にしたときだけ、狙った的へ 100% 入ります。
              開始点数を変えても、この設定の意味は 501 基準のままです。
            </p>
          </fieldset>

          <fieldset className="simulation__field">
            <legend>ブレ方向</legend>
            <div className="simulation__choices">
              {DIRECTION_LABELS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-testid={`sim-direction-${option.value}`}
                  aria-pressed={form.missDirection === option.value}
                  onClick={() => setForm((value) => ({ ...value, missDirection: option.value }))}
                >
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="simulation__field">
            <legend>最大ブレ</legend>
            <div className="simulation__choices">
              {MAX_MISS_LABELS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-testid={`sim-maxmiss-${option.value}`}
                  aria-pressed={form.maxMiss === option.value}
                  onClick={() => setForm((value) => ({ ...value, maxMiss: option.value }))}
                >
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            className="simulation__start"
            data-testid="start-simulation"
            onClick={start}
          >
            {form.startScore} で始める
          </button>
        </section>
      )}

      {game !== null && game.phase !== 'finished' && round !== null && (
        <section className="simulation__play" aria-label="SIMULATION プレイ中">
          <StatusBar
            remaining={displayLeft}
            dartsLeft={dartsLeftInRound(round)}
            status={round.bust ? 'bust' : round.checkout ? 'checkout' : 'in-progress'}
            note={
              round.bust
                ? 'このラウンドは無効です。残り点はラウンド開始時へ戻ります。'
                : round.checkout
                  ? '上がりました。'
                  : null
            }
          />

          <p className="simulation__progress" data-testid="sim-progress">
            ROUND {round.round} ／ DART {Math.min(round.throws.length + 1, 3)} of 3 ／ 通算{' '}
            {totalDarts(game)} 投
          </p>

          <Dartboard
            onSelect={(segment) => {
              if (game.phase !== 'aiming') return;
              setGame(throwAt(game, segment.id));
            }}
            markers={markers}
            disabled={game.phase !== 'aiming'}
            disabledReason={
              awaitingEntry ? '3 投の合計を入力してください。' : 'このラウンドは終わりました。'
            }
            ariaLabel="ダーツボード。狙う場所をタップすると、その狙いに対する着弾が決まります。"
          />

          <ol className="simulation__throws" aria-label="このラウンドの投擲">
            {round.throws.map((record) => (
              <ThrowRow key={record.dartIndex} record={record} />
            ))}
            {round.throws.length === 0 && (
              <li className="simulation__throws-empty">盤面をタップして 1 投目の狙いを決めます。</li>
            )}
          </ol>

          <div className="simulation__actions">
            <button
              type="button"
              data-testid="sim-undo"
              disabled={!canUndo(game)}
              onClick={() => setGame(undoLastThrow(game))}
            >
              1投戻す
            </button>
            <button
              type="button"
              className="simulation__quit"
              data-testid="sim-quit"
              onClick={() => {
                setGame(null);
                setScoreDraft('');
              }}
            >
              中断する
            </button>
          </div>

          {game.phase === 'score-entry' && (
            <section
              className="simulation__entry"
              data-testid="sim-entry"
              aria-live="polite"
              ref={entryRef}
            >
              {round.bust ? (
                <>
                  <p className="simulation__entry-title">BUST</p>
                  <p className="simulation__entry-note">
                    {bustNoteJa(round.bustReason)}
                    このラウンドは 0 点です。残り {round.leftBefore} へ戻ります。
                  </p>
                  <button
                    ref={nextButtonRef}
                    type="button"
                    data-testid="sim-next-round"
                    onClick={next}
                  >
                    次のラウンドへ
                  </button>
                </>
              ) : entry === null ? (
                <>
                  {wrongEntry ? (
                    <>
                      <p
                        className="simulation__entry-title simulation__entry-title--ng"
                        data-testid="sim-entry-verdict"
                      >
                        CALCULATION MISS
                      </p>
                      <p className="simulation__entry-note" data-testid="sim-entry-detail">
                        計算が間違っています。もう一度、この {round.throws.length} 投の合計を
                        計算してください（入力 {round.wrongEntries.join(' / ')}）。
                        正しい合計を入れるまで次のラウンドへは進みません。
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="simulation__entry-title">
                        この {round.throws.length} 投の合計は？
                      </p>
                      <p className="simulation__entry-note">
                        自分で暗算して入力してください。正しい得点はまだ出しません。
                      </p>
                    </>
                  )}
                  <div className="simulation__entry-field">
                    <input
                      ref={scoreInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={3}
                      autoComplete="off"
                      enterKeyHint="done"
                      data-testid="sim-score-input"
                      aria-label="この 3 投の合計得点"
                      value={scoreDraft}
                      onChange={(event) => setScoreDraft(event.target.value.replace(/\D/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        handleSubmitScore();
                      }}
                    />
                    <button
                      type="button"
                      data-testid="sim-score-submit"
                      disabled={scoreDraft.trim() === ''}
                      onClick={handleSubmitScore}
                    >
                      確定
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p
                    className="simulation__entry-title simulation__entry-title--ok"
                    data-testid="sim-entry-verdict"
                  >
                    正解
                  </p>
                  <p className="simulation__entry-note" data-testid="sim-entry-detail">
                    {entry.actual} 点。残り {round.leftBefore - entry.actual} です。
                    {entry.miss &&
                      `（CALCULATION MISS ${entry.wrongEntries.length} 回: ${entry.wrongEntries.join(' / ')}）`}
                  </p>
                  {/* Enter / Space でそのまま進めるよう、自動でフォーカスを当てている。 */}
                  <button
                    ref={nextButtonRef}
                    type="button"
                    data-testid="sim-next-round"
                    onClick={next}
                  >
                    {round.checkout ? 'ゲームを終える' : '次のラウンドへ'}
                  </button>
                </>
              )}
            </section>
          )}
        </section>
      )}

      {game !== null && game.phase === 'finished' && review !== null && (
        <section className="simulation__review" data-testid="sim-review" aria-label="GAME REVIEW">
          <h2 className="simulation__review-title">GAME REVIEW</h2>

          <dl className="simulation__summary" data-testid="sim-summary">
            <div>
              <dt>開始点数</dt>
              <dd data-testid="sim-summary-start">{review.summary.startScore}</dd>
            </div>
            <div>
              <dt>総投数</dt>
              <dd data-testid="sim-summary-darts">{review.summary.totalDarts}</dd>
            </div>
            <div>
              <dt>PPR</dt>
              <dd data-testid="sim-summary-ppr">{review.summary.ppr.toFixed(2)}</dd>
            </div>
            <div>
              <dt>FIRST 9 PPR</dt>
              <dd data-testid="sim-summary-first9">{review.summary.first9Ppr.toFixed(2)}</dd>
            </div>
            <div>
              <dt>CALCULATION MISS</dt>
              <dd data-testid="sim-summary-miss">{review.summary.calculationMissCount} 回</dd>
            </div>
            <div>
              <dt>BUST</dt>
              <dd data-testid="sim-summary-bust">{review.summary.bustCount} 回</dd>
            </div>
            <div>
              <dt>CHECKOUT DARTS</dt>
              <dd data-testid="sim-summary-checkout-darts">
                {review.summary.checkoutDarts ?? '—'}
              </dd>
            </div>
            <div>
              <dt>CHECKOUT SCORE</dt>
              <dd data-testid="sim-summary-checkout-score">
                {review.summary.checkoutScore ?? '—'}
              </dd>
            </div>
          </dl>

          <ul className="simulation__verdict-counts" aria-label="判断の内訳">
            {(Object.keys(review.verdictCounts) as ThrowVerdict[])
              .filter((verdict) => review.verdictCounts[verdict] > 0)
              .map((verdict) => (
                <li key={verdict} data-tone={VERDICT_TONE[verdict]}>
                  <span>{THROW_VERDICT_JA[verdict]}</span>
                  <strong data-testid={`sim-count-${verdict}`}>
                    {review.verdictCounts[verdict]}
                  </strong>
                </li>
              ))}
          </ul>

          <p className="simulation__review-note">
            評価しているのは <strong>狙い</strong> だけです。狙いが妥当なら、そこから外れた着弾は
            判断ミスとして数えません。
          </p>

          <ol className="simulation__rounds">
            {review.rounds.map((item) => (
              <li key={item.round} className="simulation__round" data-testid={`sim-round-${item.round}`}>
                <h3>
                  ROUND {item.round}
                  <span className="simulation__round-left">LEFT {item.leftBefore}</span>
                  <span className="simulation__round-scored">
                    {item.bust ? 'BUST' : `${item.scored} 点`}
                  </span>
                </h3>

                {item.entry?.miss === true && (
                  <p className="simulation__round-miss" data-testid={`sim-round-miss-${item.round}`}>
                    CALCULATION MISS {item.entry.wrongEntries.length} 回 — 入力{' '}
                    {item.entry.wrongEntries.join(' / ')} ／ 正しくは {item.entry.actual}
                  </p>
                )}

                <ol className="simulation__review-throws">
                  {item.throws.map((throwReview) => {
                    const described = describeThrow(throwReview.record);
                    return (
                      <li
                        key={throwReview.record.dartIndex}
                        data-tone={VERDICT_TONE[throwReview.verdict]}
                        data-testid={`sim-throw-${throwReview.record.dartIndex}`}
                      >
                        <div className="simulation__review-head">
                          <span className="simulation__review-dart">
                            D{throwReview.record.dartNumber}
                          </span>
                          <span className="simulation__review-left">
                            LEFT {throwReview.record.leftBefore}
                          </span>
                          <span
                            className="simulation__review-verdict"
                            data-testid={`sim-verdict-${throwReview.record.dartIndex}`}
                          >
                            {THROW_VERDICT_JA[throwReview.verdict]}
                          </span>
                        </div>
                        <p className="simulation__review-aim">
                          狙い {described.intended} ／ 着弾 {described.actual}
                          {throwReview.record.bust && '（BUST）'}
                          {throwReview.record.checkout && '（CHECKOUT）'}
                        </p>
                        <p className="simulation__review-explain">{throwReview.noteJa}</p>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>

          <button
            type="button"
            className="simulation__start"
            data-testid="sim-restart"
            onClick={() => {
              setGame(null);
              setScoreDraft('');
            }}
          >
            設定へ戻る
          </button>
        </section>
      )}
    </div>
  );
}

/**
 * 1 投の記録。
 *
 * **得点は出さない。** 合計はもちろん、1 投ごとの点数も出してしまうと
 * 暗算がただの足し算の読み上げになる。出すのは狙いと着弾だけ。
 */
function ThrowRow({ record }: { record: ThrowRecord }) {
  const described = describeThrow(record);
  return (
    <li data-testid={`sim-throw-row-${record.dartNumber}`}>
      <span className="simulation__throw-dart">D{record.dartNumber}</span>
      <span className="simulation__throw-aim">狙い {described.intended}</span>
      <span className="simulation__throw-hit">着弾 {described.actual}</span>
      {(record.bust || record.checkout) && (
        <span className="simulation__throw-flag">{record.bust ? 'BUST' : 'CHECKOUT'}</span>
      )}
    </li>
  );
}

function bustNoteJa(reason: string | null): string {
  switch (reason) {
    case 'BELOW_ZERO':
      return '残り点を超えました。';
    case 'LEFT_ONE':
      return '残り 1 になりました。';
    case 'NOT_DOUBLE_FINISH':
      return '0 になりましたが、最後のダーツがダブルではありません。';
    default:
      return '';
  }
}

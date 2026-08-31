import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dartboard } from '../components/Dartboard';
import { RouteCard } from '../components/RouteCard';
import { StatusBar } from '../components/StatusBar';
import type { Dart } from '../domain/dart';
import { MAX_CHECKOUT, MAX_SETUP_REMAINING } from '../domain/checkoutRules';
import {
  DEFAULT_TRAINING_SETTINGS,
  canGenerateQuestions,
  generateQuestions,
  type TrainingMode,
  type TrainingQuestion,
  type TrainingSettings,
} from '../engine/training/questions';
import { gradeAnswer, type GradeResult } from '../engine/training/grade';
import type { LeaveTier } from '../engine/setup/leaveQuality';
import {
  appendRecord,
  clearHistory,
  computeStats,
  loadHistory,
  reviewTargetsOf,
  type TrainingHistory,
} from '../storage/trainingHistory';
import './TrainingPage.css';

const MODE_LABEL: Record<TrainingMode, string> = {
  checkout: 'CHECKOUT',
  setup: 'SETUP',
  recovery: 'RECOVERY',
  mixed: 'MIXED',
};

/** 残り点の質を、結果画面に出す短いラベルへ変換する。 */
const LEAVE_TIER_LABEL: Record<LeaveTier, string> = {
  premium: 'テンパイ（狙って作りたい残り）',
  good: 'テンパイ（2 本でも上がれる）',
  playable: 'テンパイ',
  bogey: 'ノーテン',
  'out-of-range': '170 超え・次ラウンドでは上がれない',
};

const COUNT_OPTIONS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: '10問', value: 10 },
  { label: '30問', value: 30 },
  { label: '無限', value: null },
];

const TIME_OPTIONS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: 'なし', value: null },
  { label: '15秒', value: 15 },
  { label: '30秒', value: 30 },
];

interface SessionState {
  readonly questions: readonly TrainingQuestion[];
  readonly index: number;
  /**
   * このセッションを開始したときの設定のスナップショット。
   * 開始後に画面上の設定を編集しても、進行中のセッションは影響を受けない
   * （出題数・制限時間・追加生成のすべてでこちらを使う）。
   */
  readonly settings: TrainingSettings;
}

export function TrainingPage() {
  const [settings, setSettings] = useState<TrainingSettings>(DEFAULT_TRAINING_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [answer, setAnswer] = useState<Dart[]>([]);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [history, setHistory] = useState<TrainingHistory>(() => loadHistory());
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const startedAt = useRef<number>(0);

  const stats = useMemo(() => computeStats(history), [history]);
  const question = session ? (session.questions[session.index] ?? null) : null;

  const startSession = useCallback(
    (nextSettings: TrainingSettings) => {
      const questions = generateQuestions({
        settings: nextSettings,
        seed: Date.now() % 2147483647,
        reviewTargets: reviewTargetsOf(computeStats(loadHistory())),
        count: nextSettings.questionCount ?? 30,
      });
      setSession({ questions, index: 0, settings: nextSettings });
      setAnswer([]);
      setResult(null);
      startedAt.current = performance.now();
      setRemainingSeconds(nextSettings.timeLimitSeconds);
    },
    [],
  );

  const submit = useCallback(() => {
    if (!question || result !== null) return;
    const graded = gradeAnswer(question, answer);
    setResult(graded);
    const record = {
      id: `${question.id}-${Date.now()}`,
      at: Date.now(),
      kind: question.kind,
      remaining: question.remaining,
      dartsAvailable: question.dartsAvailable,
      answer: answer.map((dart) => dart.id),
      valid: graded.valid,
      grade: graded.grade,
      finishDouble: graded.finishDouble,
      elapsedMs: Math.round(performance.now() - startedAt.current),
    };
    setHistory(appendRecord(record));
  }, [question, answer, result]);

  /**
   * 制限時間のカウントダウン。0 になった時点の回答で自動確定する。
   * 状態更新はタイマーのコールバック内で行い、effect 本体からは呼ばない。
   */
  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return;
    if (result !== null || question === null) return;
    const timer = window.setTimeout(() => {
      if (remainingSeconds <= 1) {
        setRemainingSeconds(0);
        submit();
      } else {
        setRemainingSeconds(remainingSeconds - 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [remainingSeconds, result, question, submit]);

  const goNext = useCallback(() => {
    setSession((current) => {
      if (!current) return current;
      const nextIndex = current.index + 1;
      if (nextIndex < current.questions.length) return { ...current, index: nextIndex };
      // 無限モードでは追加生成する（開始時の設定で生成する）。
      if (current.settings.questionCount === null) {
        const more = generateQuestions({
          settings: current.settings,
          seed: Date.now() % 2147483647,
          reviewTargets: reviewTargetsOf(computeStats(loadHistory())),
          count: 10,
        });
        return { ...current, questions: [...current.questions, ...more], index: nextIndex };
      }
      return { ...current, index: nextIndex };
    });
    setAnswer([]);
    setResult(null);
    startedAt.current = performance.now();
    setRemainingSeconds(session?.settings.timeLimitSeconds ?? null);
  }, [session]);

  const finished = session !== null && question === null && session.questions.length > 0;
  // 出題できない設定（例: RECOVERY で 2〜3 の範囲）を、開始前に伝える。
  const unusableSettings = !canGenerateQuestions(settings);
  const emptySession = session !== null && session.questions.length === 0;

  return (
    <div className="training">
      <section className="training__setup" aria-label="トレーニング設定">
        <div className="training__modes" role="group" aria-label="モード">
          {(Object.keys(MODE_LABEL) as TrainingMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`training-mode-${mode}`}
              aria-pressed={settings.mode === mode}
              onClick={() => setSettings((value) => ({ ...value, mode }))}
            >
              {MODE_LABEL[mode]}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="training__settings-toggle"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          {settingsOpen ? '詳細設定を閉じる' : '詳細設定'}
        </button>

        {settingsOpen && (
          <div className="training__settings" data-testid="training-settings">
            <label>
              <span>CHECKOUT 出題範囲</span>
              <span className="training__range">
                <input
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={MAX_CHECKOUT}
                  value={settings.checkoutRange.min}
                  aria-label="CHECKOUT 最小値"
                  onChange={(event) =>
                    setSettings((value) => ({
                      ...value,
                      checkoutRange: { ...value.checkoutRange, min: Number(event.target.value) },
                    }))
                  }
                />
                <span aria-hidden="true">〜</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={MAX_CHECKOUT}
                  value={settings.checkoutRange.max}
                  aria-label="CHECKOUT 最大値"
                  onChange={(event) =>
                    setSettings((value) => ({
                      ...value,
                      checkoutRange: { ...value.checkoutRange, max: Number(event.target.value) },
                    }))
                  }
                />
              </span>
            </label>

            <label>
              <span>SETUP 出題範囲</span>
              <span className="training__range">
                <input
                  type="number"
                  inputMode="numeric"
                  min={171}
                  max={MAX_SETUP_REMAINING}
                  value={settings.setupRange.min}
                  aria-label="SETUP 最小値"
                  onChange={(event) =>
                    setSettings((value) => ({
                      ...value,
                      setupRange: { ...value.setupRange, min: Number(event.target.value) },
                    }))
                  }
                />
                <span aria-hidden="true">〜</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={171}
                  max={MAX_SETUP_REMAINING}
                  value={settings.setupRange.max}
                  aria-label="SETUP 最大値"
                  onChange={(event) =>
                    setSettings((value) => ({
                      ...value,
                      setupRange: { ...value.setupRange, max: Number(event.target.value) },
                    }))
                  }
                />
              </span>
            </label>

            <fieldset>
              <legend>出題数</legend>
              {COUNT_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={settings.questionCount === option.value}
                  onClick={() => setSettings((value) => ({ ...value, questionCount: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>

            <fieldset>
              <legend>制限時間</legend>
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={settings.timeLimitSeconds === option.value}
                  onClick={() =>
                    setSettings((value) => ({ ...value, timeLimitSeconds: option.value }))
                  }
                >
                  {option.label}
                </button>
              ))}
            </fieldset>

            <label className="training__checkbox">
              <input
                type="checkbox"
                checked={settings.reviewWeakFirst}
                onChange={(event) =>
                  setSettings((value) => ({ ...value, reviewWeakFirst: event.target.checked }))
                }
              />
              <span>苦手・間違えた問題を重点的に出題する</span>
            </label>
          </div>
        )}

        {unusableSettings && (
          <p className="training__unusable" data-testid="training-unusable" role="alert">
            この設定では出題できる問題がありません。出題範囲を広げてください。
          </p>
        )}

        <button
          type="button"
          className="training__start"
          data-testid="start-training"
          onClick={() => startSession(settings)}
          disabled={unusableSettings}
        >
          {session === null ? 'トレーニングを始める' : 'この設定でやり直す'}
        </button>
      </section>

      {question && (
        <>
          <StatusBar
            remaining={question.remaining}
            dartsLeft={question.dartsAvailable}
            note={question.promptJa}
          />

          {remainingSeconds !== null && (
            <p className="training__timer" data-testid="training-timer" role="timer">
              残り {Math.max(remainingSeconds, 0)} 秒
            </p>
          )}

          <p className="training__progress" data-testid="training-progress">
            {session!.settings.questionCount === null
              ? `${session!.index + 1} 問目`
              : `${session!.index + 1} / ${session!.settings.questionCount} 問目`}
          </p>

          <p className="training__hint">
            狙う場所を順にタップしてください（「そこへ刺さった」ではなく「そこを狙う」という回答です）。
          </p>

          <Dartboard
            onSelect={(segment) => {
              if (result !== null) return;
              if (answer.length >= question.dartsAvailable) return;
              setAnswer((current) => [...current, segment.dart]);
            }}
            highlightedDartIds={answer.map((dart) => dart.id)}
            disabled={result !== null || answer.length >= question.dartsAvailable}
            disabledReason={
              result !== null ? '採点済みです。' : '本数を使い切りました。回答するか、戻してください。'
            }
            ariaLabel="ダーツボード。狙う場所を順に選んでください。"
          />

          <ol className="training__answer" aria-label="あなたの回答">
            {Array.from({ length: question.dartsAvailable }, (_, index) => (
              <li key={index} data-testid={`answer-${index}`}>
                {answer[index]?.id ?? '—'}
              </li>
            ))}
          </ol>

          <div className="training__actions">
            <button
              type="button"
              data-testid="training-undo"
              onClick={() => setAnswer((current) => current.slice(0, -1))}
              disabled={answer.length === 0 || result !== null}
            >
              1投戻す
            </button>
            <button
              type="button"
              className="training__submit"
              data-testid="training-submit"
              onClick={submit}
              disabled={result !== null || answer.length === 0}
            >
              回答する
            </button>
            <button
              type="button"
              data-testid="training-next"
              onClick={goNext}
              disabled={result === null}
            >
              次の問題
            </button>
          </div>

          {result && (
            <section className="training__result" data-testid="training-result" aria-live="polite">
              <p
                className={`training__verdict training__verdict--${result.valid ? 'ok' : 'ng'}`}
                data-testid="training-verdict"
              >
                {result.valid
                  ? `成立します（推奨度 ${result.grade}）`
                  : `成立しません — ${result.invalidMessageJa}`}
              </p>

              {result.checkoutEvaluation && (
                <RouteCard
                  testId="training-answer-route"
                  badge="あなたの回答"
                  grade={result.checkoutEvaluation.grade}
                  dartIds={result.checkoutEvaluation.darts.map((dart) => dart.id)}
                  reasons={result.checkoutEvaluation.reasons.map((reason) => ({ ...reason }))}
                  defaultOpen
                />
              )}
              {result.setupEvaluation && (
                <RouteCard
                  testId="training-answer-route"
                  badge="あなたの回答"
                  grade={result.setupEvaluation.grade}
                  dartIds={result.setupEvaluation.darts.map((dart) => dart.id)}
                  meta={`取得 ${result.setupEvaluation.scored} 点 → 残り ${result.setupEvaluation.leave}（${
                    LEAVE_TIER_LABEL[result.setupEvaluation.leaveTier]
                  }）`}
                  reasons={result.setupEvaluation.reasons.map((reason) => ({ ...reason }))}
                  defaultOpen
                />
              )}

              {result.bestCheckout && result.bestCheckout.key !== result.checkoutEvaluation?.key && (
                <RouteCard
                  testId="training-best-route"
                  badge="より良いルート"
                  isStandard={result.bestCheckout.isStandard}
                  grade={result.bestCheckout.grade}
                  dartIds={result.bestCheckout.darts.map((dart) => dart.id)}
                  reasons={result.bestCheckout.reasons.map((reason) => ({ ...reason }))}
                />
              )}
              {result.bestSetup && result.bestSetup.key !== result.setupEvaluation?.key && (
                <RouteCard
                  testId="training-best-route"
                  badge="より良いルート"
                  grade={result.bestSetup.grade}
                  dartIds={result.bestSetup.darts.map((dart) => dart.id)}
                  meta={`取得 ${result.bestSetup.scored} 点 → 残り ${result.bestSetup.leave}`}
                  reasons={result.bestSetup.reasons.map((reason) => ({ ...reason }))}
                />
              )}
            </section>
          )}
        </>
      )}

      {finished && (
        <p className="training__finished" data-testid="training-finished">
          このセットは終わりです。おつかれさまでした。
        </p>
      )}

      {emptySession && (
        <p className="training__finished" data-testid="training-empty-session" role="alert">
          この設定では出題できる問題がありませんでした。出題範囲を広げてから、もう一度始めてください。
        </p>
      )}

      <section className="training__stats" aria-label="学習履歴">
        <h2>学習履歴</h2>
        <dl data-testid="training-stats">
          <div>
            <dt>回答数</dt>
            <dd data-testid="stat-attempts">{stats.attempts}</dd>
          </div>
          <div>
            <dt>正答率</dt>
            <dd data-testid="stat-accuracy">{Math.round(stats.accuracy * 100)}%</dd>
          </div>
          <div>
            <dt>平均回答時間</dt>
            <dd>{(stats.averageMs / 1000).toFixed(1)} 秒</dd>
          </div>
          <div>
            <dt>連続正解</dt>
            <dd>
              {stats.currentStreak}（最高 {stats.bestStreak}）
            </dd>
          </div>
          <div>
            <dt>非推奨ルート選択</dt>
            <dd>{stats.discouragedChoices} 回</dd>
          </div>
        </dl>

        {stats.byGrade && (
          <p className="training__grades">
            S {stats.byGrade.S} / A {stats.byGrade.A} / B {stats.byGrade.B} / C {stats.byGrade.C} /
            不成立 {stats.byGrade.invalid}
          </p>
        )}

        {stats.weakScores.length > 0 && (
          <p className="training__weak">
            苦手スコア: {stats.weakScores.slice(0, 8).join(', ')}
          </p>
        )}

        {stats.byScoreBand.length > 0 && (
          <table className="training__table">
            <caption>スコア帯別</caption>
            <thead>
              <tr>
                <th scope="col">帯</th>
                <th scope="col">回答</th>
                <th scope="col">正答率</th>
              </tr>
            </thead>
            <tbody>
              {stats.byScoreBand.map((item) => (
                <tr key={item.key}>
                  <th scope="row">{item.key}</th>
                  <td>{item.attempts}</td>
                  <td>{Math.round(item.accuracy * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {stats.byFinishDouble.length > 0 && (
          <table className="training__table">
            <caption>上がりダブル別</caption>
            <thead>
              <tr>
                <th scope="col">ダブル</th>
                <th scope="col">回答</th>
                <th scope="col">正答率</th>
              </tr>
            </thead>
            <tbody>
              {stats.byFinishDouble.map((item) => (
                <tr key={item.key}>
                  <th scope="row">{item.key}</th>
                  <td>{item.attempts}</td>
                  <td>{Math.round(item.accuracy * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button
          type="button"
          className="training__clear"
          data-testid="clear-history"
          onClick={() => {
            clearHistory();
            setHistory(loadHistory());
          }}
        >
          学習履歴を消去
        </button>
      </section>
    </div>
  );
}

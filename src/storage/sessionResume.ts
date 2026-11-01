/**
 * 進行中の TRAINING / SIMULATION の一時保存（2026-11-01 監査 U-H3）。
 *
 * Android / ブラウザの「戻る」や、更新バナーからの再読み込みで途中経過が
 * 消えないようにするための保存。学習履歴（trainingHistory.ts）とは別のキーで、
 * 1 セッションぶんだけを持つ。
 *
 * - 版（`version`）を付け、知らない版・壊れたデータは**読まずに捨てる**
 *   （画面が落ちる原因にしない）。
 * - TRAINING は出題そのものではなく、**出題を作り直すための入力**（seed・復習対象・
 *   問題数）を保存する。出題は同じ seed から同じ並びが作られる（sampling.ts）。
 * - SIMULATION のゲーム状態はもともとプレーンなデータ（seed と乱数の消費数）なので
 *   そのまま保存する。
 */
import type { SimulationGame } from '../engine/simulation/game';
import type { TrainingSettings } from '../engine/training/questions';
import type { ReviewTarget } from '../engine/training/model';
import { readJson, removeKey, writeJson } from './localJson';

export const TRAINING_SESSION_KEY = 'oas.training.session.v1';
export const SIMULATION_SESSION_KEY = 'oas.simulation.session.v1';

const VERSION = 1;

/** 出題を作り直すための 1 回ぶんの生成条件。 */
export interface TrainingChunk {
  readonly seed: number;
  readonly count: number;
  readonly reviewTargets: readonly (ReviewTarget | number)[];
}

export interface SavedTrainingSession {
  readonly version: typeof VERSION;
  readonly savedAt: number;
  readonly settings: TrainingSettings;
  readonly chunks: readonly TrainingChunk[];
  /** いま解いている問題の番号（0 始まり）。 */
  readonly index: number;
  /** 回答欄に入っている的（Dart ID）。 */
  readonly answer: readonly string[];
  /** この問題を採点済みか（採点済みなら再開時に結果を出し直す。履歴へは二重に記録しない）。 */
  readonly answered: boolean;
  readonly remainingSeconds: number | null;
}

export interface SavedSimulationSession {
  readonly version: typeof VERSION;
  readonly savedAt: number;
  readonly game: SimulationGame;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

const validRange = (value: unknown): boolean =>
  isObject(value) && isInt(value.min) && isInt(value.max) && value.min <= value.max;

function validTrainingSettings(value: unknown): value is TrainingSettings {
  if (!isObject(value)) return false;
  return (
    typeof value.mode === 'string' &&
    validRange(value.checkoutRange) &&
    validRange(value.setupRange) &&
    typeof value.reviewWeakFirst === 'boolean' &&
    ['checkout', 'setup', 'recovery', 'mixed'].includes(value.mode) &&
    (value.questionCount === null || isInt(value.questionCount)) &&
    (value.timeLimitSeconds === null || isInt(value.timeLimitSeconds))
  );
}

function validChunk(value: unknown): value is TrainingChunk {
  return (
    isObject(value) &&
    isInt(value.seed) &&
    isInt(value.count) &&
    value.count > 0 &&
    value.count <= 100 &&
    Array.isArray(value.reviewTargets)
  );
}

/** 保存データの形を確かめる。少しでも合わなければ null（捨てる）。 */
export function parseTrainingSession(raw: unknown): SavedTrainingSession | null {
  if (!isObject(raw) || raw.version !== VERSION) return null;
  if (!validTrainingSettings(raw.settings)) return null;
  if (!Array.isArray(raw.chunks) || raw.chunks.length === 0 || raw.chunks.length > 200) return null;
  if (!raw.chunks.every(validChunk)) return null;
  if (!isInt(raw.index) || raw.index < 0) return null;
  if (!Array.isArray(raw.answer) || !raw.answer.every((id) => typeof id === 'string')) return null;
  if (typeof raw.answered !== 'boolean') return null;
  if (!(raw.remainingSeconds === null || isInt(raw.remainingSeconds))) return null;
  return {
    version: VERSION,
    savedAt: isInt(raw.savedAt) ? raw.savedAt : 0,
    settings: raw.settings,
    chunks: raw.chunks,
    index: raw.index,
    answer: raw.answer as string[],
    answered: raw.answered,
    remainingSeconds: raw.remainingSeconds as number | null,
  };
}

const PHASES = ['aiming', 'score-entry', 'finished'];

function validThrows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    value.every(
      (record) =>
        isObject(record) &&
        typeof record.intendedSegmentId === 'string' &&
        typeof record.actualDartId === 'string' &&
        isInt(record.score) &&
        isInt(record.leftAfter) &&
        isObject(record.intendedPoint) &&
        isObject(record.actualPoint),
    )
  );
}

/** 進行中のラウンド（`ActiveRound`）。未確定の計算ミスは直下の `wrongEntries` に持つ。 */
function validActiveRound(value: unknown): boolean {
  return (
    isObject(value) &&
    isInt(value.round) &&
    isInt(value.leftBefore) &&
    validThrows(value.throws) &&
    Array.isArray(value.wrongEntries) &&
    (value.entry === null || isObject(value.entry))
  );
}

/**
 * 確定したラウンド（`RoundRecord`）。`advanceRound()` は `wrongEntries` を直下に持たせず、
 * 暗算の記録は `entry` の中に置く（BUST のラウンドは entry が null）。
 */
function validCommittedRound(value: unknown): boolean {
  return (
    isObject(value) &&
    isInt(value.round) &&
    isInt(value.leftBefore) &&
    isInt(value.leftAfter) &&
    isInt(value.scored) &&
    validThrows(value.throws) &&
    (value.entry === null || value.entry === undefined || isObject(value.entry))
  );
}

export function parseSimulationSession(raw: unknown): SavedSimulationSession | null {
  if (!isObject(raw) || raw.version !== VERSION || !isObject(raw.game)) return null;
  const game = raw.game;
  if (!isObject(game.settings) || !isInt(game.settings.startScore)) return null;
  if (!isInt(game.seed) || !isInt(game.draws) || game.draws < 0) return null;
  if (typeof game.phase !== 'string' || !PHASES.includes(game.phase)) return null;
  if (!isInt(game.left) || game.left < 0) return null;
  if (!Array.isArray(game.rounds) || !game.rounds.every(validCommittedRound)) return null;
  if (!(game.current === null || validActiveRound(game.current))) return null;
  if (typeof game.abandoned !== 'boolean') return null;
  return {
    version: VERSION,
    savedAt: isInt(raw.savedAt) ? raw.savedAt : 0,
    game: game as unknown as SimulationGame,
  };
}

export function loadTrainingSession(): SavedTrainingSession | null {
  const parsed = parseTrainingSession(readJson<unknown>(TRAINING_SESSION_KEY, null));
  if (parsed === null) removeKey(TRAINING_SESSION_KEY);
  return parsed;
}

export function saveTrainingSession(
  session: Omit<SavedTrainingSession, 'version' | 'savedAt'>,
): void {
  writeJson(TRAINING_SESSION_KEY, { ...session, version: VERSION, savedAt: Date.now() });
}

export function clearTrainingSession(): void {
  removeKey(TRAINING_SESSION_KEY);
}

export function loadSimulationSession(): SavedSimulationSession | null {
  const parsed = parseSimulationSession(readJson<unknown>(SIMULATION_SESSION_KEY, null));
  if (parsed === null) removeKey(SIMULATION_SESSION_KEY);
  return parsed;
}

export function saveSimulationSession(game: SimulationGame): void {
  writeJson(SIMULATION_SESSION_KEY, { version: VERSION, savedAt: Date.now(), game });
}

export function clearSimulationSession(): void {
  removeKey(SIMULATION_SESSION_KEY);
}

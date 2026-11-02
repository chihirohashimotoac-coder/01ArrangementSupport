/**
 * 監査フェーズ 2 / 2-4: 推奨度 S の呼び方。基準ルート自身は「基準ルート」、それ以外の S は「基準と同等」。
 * 以前はどちらも「基準推奨」で、OTHER ROUTES に基準ルートが複数あるように見えていた（121 の T11 → T16 → D20）。
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { routeGradeLabelJa } from './data/gradeLabels';
import { rankCheckoutRoutes } from './engine/ranking/checkoutRanking';
import { parseRoute } from './domain/dart';
import { gradeAnswer } from './engine/training/grade';
import { buildFeedback } from './engine/training/feedback';
import { checkoutProblemKey, type TrainingQuestion } from './engine/training/model';

const question = (left: number, darts: number): TrainingQuestion => ({
  id: 'q',
  problemKey: checkoutProblemKey(left, darts),
  kind: 'checkout',
  format: 'checkout-route',
  difficulty: 'medium',
  primaryCategory: 'checkout-100-119',
  learningTags: [],
  startRemaining: left,
  currentRemaining: left,
  dartsAvailable: darts,
  visitDartsAvailable: darts,
  contextualThrows: [],
  promptJa: '',
  recovery: null,
  expectedAnswer: [],
  trivial: false,
});

describe('推奨度 S の呼び方', () => {
  it('基準ルートは「基準ルート」、それ以外の S は「基準と同等」、SETUP の BEST は「最上位の候補」', () => {
    expect(routeGradeLabelJa('S', true)).toBe('基準ルート');
    expect(routeGradeLabelJa('S', false)).toBe('基準と同等');
    expect(routeGradeLabelJa('S', false, true)).toBe('最上位の候補');
    expect(routeGradeLabelJa('A', true)).toBe('非常に良い代替');
  });

  it('121: STANDARD は「基準ルート」、OTHER ROUTES の S（T11 → T16 → D20）は「基準と同等」', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('nav-checkout'));
    await user.type(screen.getByTestId('score-input'), '121');
    expect(screen.getByTestId('standard-route')).toHaveTextContent('推奨度 S: 基準ルート');

    const other = rankCheckoutRoutes(121, 3).find((route) => !route.isStandard && route.grade === 'S')!;
    expect(other.key).toBe('T11-T16-D20');
    await user.click(screen.getByTestId('show-all-routes'));
    const card = screen.getByTestId(`route-${other.key}`);
    expect(within(card).getByText(/推奨度 S:/)).toHaveTextContent('推奨度 S: 基準と同等');
    expect(card).not.toHaveTextContent('基準推奨');
  });

  it('TRAINING の判定文も同じ呼び方にする', () => {
    const q = question(121, 3);
    const standard = parseRoute(['T20', 'S11', 'BULL']);
    expect(buildFeedback(q, standard, gradeAnswer(q, standard)).verdictJa).toBe('正解（推奨度 S・基準ルート）');
    const peer = parseRoute(['T11', 'T16', 'D20']);
    expect(buildFeedback(q, peer, gradeAnswer(q, peer)).verdictJa).toMatch(/^正解（推奨度 S・基準と同等/);
  });
});

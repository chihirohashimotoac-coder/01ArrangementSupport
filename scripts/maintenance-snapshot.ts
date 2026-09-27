/** Stable comparison of every suggestion's candidates, order, grades and practical choice. */
import { createHash } from 'node:crypto';
import { suggestFor } from '../src/engine/recovery/suggest';

const settings = [
  { mainTarget: 'T20', fallbackPreferredDoubles: [] },
  { mainTarget: 'T20', fallbackPreferredDoubles: ['D20'] },
  { mainTarget: 'T20', fallbackPreferredDoubles: ['D16'] },
  { mainTarget: 'T20', fallbackPreferredDoubles: ['D8'] },
  { mainTarget: 'T19', fallbackPreferredDoubles: [] },
  { mainTarget: 'T19', fallbackPreferredDoubles: ['D20'] },
  { mainTarget: 'T19', fallbackPreferredDoubles: ['D16'] },
  { mainTarget: 'T19', fallbackPreferredDoubles: ['D8'] },
] as const;

// PR #29 merge (d0259ba): recorded before changing any implementation.
const BASELINE = '602e43693d5df9fa3fc3429759bb0147a507fa1694f1091775fb1a4044f83877';
const hash = createHash('sha256');
let states = 0;
for (const options of settings) {
  for (let left = 2; left <= 350; left += 1) {
    for (let darts = 1; darts <= 3; darts += 1) {
      const suggestion = suggestFor(left, darts, options);
      hash.update(JSON.stringify({
        options, left, darts, mode: suggestion.mode,
        checkout: suggestion.checkoutRoutes.map((route) => [route.key, route.grade]),
        setup: suggestion.setupRoutes.map((route) => [route.key, route.grade]),
        next: suggestion.nextVisitProposals.map((item) => [item.route.key, item.route.grade]),
        practical: suggestion.practicalLastDart?.dartId ?? null,
      }) + '\n');
      states += 1;
    }
  }
}
const digest = hash.digest('hex');
console.log(`suggestFor states=${states} sha256=${digest}`);
if (states !== 8376 || digest !== BASELINE) process.exitCode = 1;

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/*
 * jsdom は scrollIntoView を実装していない。
 * 入力完了時の画面移動（PracticePage）はテストで呼ばれるので、
 * 呼んでも落ちない no-op を用意しておく（spy を張る土台にもなる）。
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

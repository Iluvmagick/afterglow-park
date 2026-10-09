// Sound follows focus: it must end up on when the tab is focused and off when it isn't, however fast
// focus comes and goes (suspend() and resume() take a while to settle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';

// stands in for an AudioContext: suspend()/resume() settle after a delay and only then change state
function fakeContext() {
  const ctx = { state: 'running' };
  const settle = (to) => new Promise((resolve) => setTimeout(() => resolve((ctx.state = to)), 15));
  ctx.suspend = () => settle('suspended');
  ctx.resume = () => settle('running');
  return ctx;
}

test('audio: quick focus changes always settle on the latest one', async () => {
  for (const calls of [
    [false, true], // blur + focus (e.g. going fullscreen): sound must come back
    [true, false],
    [false, true, false],
    [true, false, true, false, true, false, true],
    [false, false, true, true, false],
  ]) {
    const audio = new GameAudio();
    audio.ctx = fakeContext();
    audio.offline = false;
    for (const active of calls) audio.setActive(active);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(audio.ctx.state, calls.at(-1) ? 'running' : 'suspended', `after ${calls.join(', ')}`);
  }
});

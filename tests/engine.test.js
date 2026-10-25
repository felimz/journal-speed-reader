import test from 'node:test';
import assert from 'node:assert/strict';
import { RSVPEngine } from '../src/reader/engine.js';
import { buildRSVPTokens, calculateORP, calculatePause } from '../src/processing/tokenizer.js';
import { sanitizeTokens } from '../src/processing/sanitizer.js';

const tokens = (...words) => buildRSVPTokens(words.map(word => ({ word })));

test('progress remains finite for empty and single-word documents', async () => {
  const empty = new RSVPEngine([]);
  assert.equal(empty.progress, 0);
  const single = new RSVPEngine(tokens('Alpha'));
  assert.equal(single.progress, 0);
  const progressEvents = [];
  single.on('progress', progress => progressEvents.push(progress));
  single.skip(10);
  single.reset();
  single.setWPM(900);
  const completed = new Promise(resolve => single.on('complete', resolve));
  single.play();
  await completed;
  assert.ok(progressEvents.length >= 3);
  assert.ok(progressEvents.every(progress => Number.isFinite(progress) && progress >= 0 && progress <= 1));
  assert.equal(single.progress, 1);
  assert.equal(progressEvents.at(-1), 1);
  empty.destroy();
  single.destroy();
});

test('seek, skip, reset and speed limits preserve their boundaries', () => {
  const engine = new RSVPEngine(tokens(...Array.from({ length: 30 }, (_, i) => String(i))));
  engine.skip(10);
  assert.equal(engine.currentIndex, 10);
  engine.skip(-100);
  assert.equal(engine.currentIndex, 0);
  engine.seekTo(100);
  assert.equal(engine.currentIndex, 29);
  assert.equal(engine.progress, 1);
  engine.reset();
  assert.equal(engine.currentIndex, 0);
  engine.setWPM(20);
  assert.equal(engine.wpm, 100);
  engine.setWPM(2000);
  assert.equal(engine.wpm, 900);
  engine.destroy();
});

test('playback completes, replays, and stops when paused', async () => {
  const engine = new RSVPEngine(tokens('Alpha', 'beta', 'gamma'));
  engine.setWPM(900);
  const words = [];
  engine.on('word', token => words.push(token.word));
  const completed = new Promise(resolve => engine.on('complete', resolve));
  try {
    engine.play();
    await completed;
    assert.equal(engine.isPlaying, false);
    assert.deepEqual(words, ['Alpha', 'beta', 'gamma']);
    assert.equal(engine.progress, 1);
    engine.play();
    engine.pause();
    const index = engine.currentIndex;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(engine.currentIndex, index);
    assert.equal(words.at(-1), 'Alpha');
  } finally {
    engine.destroy();
  }
});

test('tokenization preserves text, recognition pivots and pause metadata', () => {
  for (const [word, pivotIndex] of [['a', 0], ['alpha', 1], ['reader', 2], ['understood', 3], ['characterization', 4]]) {
    const token = tokens(word)[0];
    assert.equal(calculateORP(word), pivotIndex);
    assert.equal(token.before + token.pivot + token.after, word);
  }
  assert.equal(calculatePause('word'), 0);
  assert.equal(calculatePause('word.'), 60);
  assert.equal(calculatePause('word', true), 200);
  assert.equal(calculatePause('word', true, 'Methods'), 800);
  assert.deepEqual(sanitizeTokens([
    { word: '\ufb01nd\u200b', sectionBefore: 'Results', paragraphBreak: true },
    { word: 'method.The' },
  ]), [
    { word: 'find', sectionBefore: 'Results', paragraphBreak: true },
    { word: 'method.' },
    { word: 'The' },
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { stepFree } from '../src/behaviors/numbers.js';

test('a free step lands on the next multiple of the amount in its direction', () => {
  assert.equal(stepFree(105, 10), 110, 'off the grid, up: the next multiple, not 115');
  assert.equal(stepFree(105, -10), 100, 'off the grid, down');
  assert.equal(stepFree(100, 10), 110, 'on the grid, up: one whole amount');
  assert.equal(stepFree(100, -10), 90, 'on the grid, down');
  assert.equal(stepFree(-5, 10), 0, 'negative values');
  assert.equal(stepFree(0.0123456, 1), 1, 'a converted unit aligns on the first step');
});

test('a free step keeps the decimals of its amount: no floating-point noise', () => {
  assert.equal(stepFree(0.2, 0.1), 0.3);
  assert.equal(stepFree(0.3, -0.1), 0.2);
  assert.equal(stepFree(0.7, 0.1), 0.8);
  assert.equal(stepFree(1.15, 0.05), 1.2);
  assert.equal(stepFree(0.0123456, 0.0000001), 0.0123457);
  assert.equal(stepFree(2.5, -0.25), 2.25);
});

test('a free step stays within min and max, and does not move past a limit already reached', () => {
  assert.equal(stepFree(95, 10, { max: 100 }), 100, 'clamped to max');
  assert.equal(stepFree(100, 10, { max: 100 }), 100, 'at max: unchanged');
  assert.equal(stepFree(120, 10, { max: 100 }), 120, 'past max, up: unchanged (as stepUp)');
  assert.equal(stepFree(5, -10, { min: 0 }), 0, 'clamped to min');
  assert.equal(stepFree(0, -1, { min: 0 }), 0, 'at min: unchanged');
});

test('the grid of a free step counts from its base (the field\'s min)', () => {
  assert.equal(stepFree(3, 10, { min: 3, base: 3 }), 13);
  assert.equal(stepFree(5, 10, { min: 3, base: 3 }), 13);
  assert.equal(stepFree(13, -10, { min: 3, base: 3 }), 3);
});

test('an empty field counts as 0, as with stepUp; a zero or invalid amount changes nothing', () => {
  assert.equal(stepFree(NaN, 1), 1);
  assert.equal(stepFree(NaN, -1), -1);
  assert.equal(stepFree(NaN, 1, { min: 5, base: 5 }), 5, 'then clamped to min');
  assert.equal(stepFree(7, 0), 7);
  assert.equal(stepFree(7, NaN), 7);
  assert.equal(stepFree(7, Infinity), 7);
});

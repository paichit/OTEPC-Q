import test from 'node:test';
import assert from 'node:assert/strict';
import { queueAudioPath } from '../src/lib/recordedAudio.js';

test('recorded queue audio uses only valid queue numbers', () => {
  assert.equal(queueAudioPath('A001'), '/queue-audio/A001.mp3');
  assert.equal(queueAudioPath('B1000'), '/queue-audio/B1000.mp3');
  assert.equal(queueAudioPath('../A001'), null);
  assert.equal(queueAudioPath('A01'), null);
});

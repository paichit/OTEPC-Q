import test from 'node:test';
import assert from 'node:assert/strict';
import { googleThaiPreference, googleThaiVoice, selectedThaiVoice, thaiVoices, voiceNotice } from '../src/lib/voices.js';

test('Google Thai is preferred and a local Thai voice keeps announcements available', () => {
  const google = { name: 'Google ไทย', lang: 'th-TH', voiceURI: 'google-thai' };
  const other = { name: 'Microsoft Premwadee', lang: 'th-TH', voiceURI: 'microsoft-thai' };
  const english = { name: 'Google US English', lang: 'en-US', voiceURI: 'google-en' };
  const voices = thaiVoices({ getVoices: () => [english, other, google] });
  assert.deepEqual(voices, [other, google]);
  assert.equal(googleThaiVoice(voices), google);
  assert.equal(selectedThaiVoice(googleThaiPreference, voices), google);
  assert.equal(selectedThaiVoice(other.voiceURI, voices), other);
  assert.equal(selectedThaiVoice(googleThaiPreference, [other]), other);
  assert.match(voiceNotice(googleThaiPreference, [other]), /Microsoft Premwadee/);
  assert.equal(selectedThaiVoice(googleThaiPreference, []), undefined);
});

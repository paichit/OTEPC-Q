import test from 'node:test';
import assert from 'node:assert/strict';
import { announcementText, normalizeSettings, defaults, bangkokDate, textColor } from '../src/lib/queue.js';
test('speech separates every queue character and replaces every placeholder', () => {
  assert.equal(announcementText('คิว {q} ช่อง {counter} คิว {q}', { queue_number: 'A001', counter_number: 2 }), 'คิว A 0 0 1 ช่อง จุดบริการหลัก คิว A 0 0 1');
});
test('date boundary uses Bangkok instead of browser time zone', () => {
  assert.equal(bangkokDate(new Date('2026-09-22T16:59:59Z')), '2026-09-22');
  assert.equal(bangkokDate(new Date('2026-09-22T17:00:00Z')), '2026-09-23');
});
test('settings recover from invalid storage and clamp speed', () => {
  assert.deepEqual(normalizeSettings(null), defaults);
  assert.equal(defaults.voice, 'google-cloud-standard-a');
  assert.equal(defaults.announcement, 'ขอเชิญหมายเลขคิว {q} ที่ห้องประชุมค่ะ');
  assert.equal(normalizeSettings({ voice: 'google-thai', announcement: 'ข้อความเดิม' }).voice, defaults.voice);
  assert.equal(normalizeSettings({ voice: 'google-thai', announcement: 'ข้อความเดิม' }).announcement, defaults.announcement);
  assert.equal(normalizeSettings({ announcement: 'เชิญ {q} เข้าห้องประชุม' }).announcement, 'เชิญ {q} เข้าห้องประชุม');
  assert.equal(defaults.ttsRate, 0.75);
  assert.equal(defaults.marquee, 'สำนักงาน ก.ค.ศ. ยินดีต้อนรับ • กรุณาเตรียมเอกสารให้พร้อม และรอเรียกหมายเลขคิวของท่าน • ขอบคุณค่ะ');
  assert.equal(normalizeSettings({ speed: 999, sound: false, colorA: 'red' }).speed, 60);
  assert.equal(normalizeSettings({ sound: false }).sound, false);
  assert.equal(normalizeSettings({ colorA: 'red' }).colorA, defaults.colorA);
  assert.equal(normalizeSettings({ ttsRate: 9 }).ttsRate, 1.5);
  assert.equal(normalizeSettings({ displayBgA: 'bad' }).displayBgA, defaults.displayBgA);
  assert.equal(normalizeSettings({ idleMarquee: '  ' }).idleMarquee, defaults.idleMarquee);
  assert.equal(normalizeSettings({ ttsVolume: -1 }).ttsVolume, 0);
});
test('button labels contrast with chosen colors', () => {
  assert.equal(textColor('#ffffff'), '#10213b');
  assert.equal(textColor('#000000'), '#ffffff');
});

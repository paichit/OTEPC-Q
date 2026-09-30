import { defaultGroups, groupLabels, namedQueue } from './groups.js';
import { cloudTtsPreference } from '../services/cloudTts.js';

export const groups = defaultGroups;
export const defaults = {
  groupNameA: groups.A, groupNameB: groups.B,
  sound: true,
  voice: cloudTtsPreference,
  ttsRate: 0.75,
  ttsVolume: 1,
  announcement: 'ขอเชิญบัตรคิว {q} ที่ห้องประชุมค่ะ',
  marquee: 'สำนักงาน ก.ค.ศ. ยินดีต้อนรับ • กรุณาเตรียมเอกสารให้พร้อม และรอเรียกหมายเลขคิวของท่าน • ขอบคุณค่ะ',
  speed: 24, colorA: '#B1F8F2', colorB: '#AAF683',
  displayBgA: '#f8fafc', displayBgB: '#f8fafc',
  displayTextA: '#0f172a', displayTextB: '#0f172a',
  displayPulseA: '#2563eb', displayPulseB: '#16a34a',
  waitingCardColor: '#2563eb', marqueeColor: '#facc15',
  idleMarquee: 'สำนักงาน ก.ค.ศ. ยินดีต้อนรับ กรุณารอเรียกคิวค่ะ',
};
export function normalizeSettings(value) {
  const v = value && typeof value === 'object' ? value : {};
  const oldMarquee = 'ยินดีต้อนรับ • กรุณาเตรียมเอกสารให้พร้อม และรอเรียกหมายเลขคิวของท่าน • ขอบคุณที่ใช้บริการ';
  const announcement = typeof v.announcement === 'string' ? v.announcement.trim() : '';
  return {
    groupNameA: typeof v.groupNameA === 'string' && v.groupNameA.trim() ? v.groupNameA.trim().slice(0, 40) : defaults.groupNameA,
    groupNameB: typeof v.groupNameB === 'string' && v.groupNameB.trim() ? v.groupNameB.trim().slice(0, 40) : defaults.groupNameB,
    sound: typeof v.sound === 'boolean' ? v.sound : defaults.sound,
    voice: defaults.voice,
    ttsRate: Number.isFinite(Number(v.ttsRate)) ? Math.min(1.5, Math.max(0.5, Number(v.ttsRate))) : defaults.ttsRate,
    ttsVolume: Number.isFinite(Number(v.ttsVolume)) ? Math.min(1, Math.max(0, Number(v.ttsVolume))) : defaults.ttsVolume,
    announcement: announcement === 'ขอเชิญหมายเลขคิว {q} ที่ห้องประชุมค่ะ'
      ? defaults.announcement
      : announcement.length <= 200 && announcement.split('{q}').length === 2 ? announcement : defaults.announcement,
    marquee: typeof v.marquee === 'string' && v.marquee.trim() && v.marquee !== oldMarquee ? v.marquee.slice(0, 500) : defaults.marquee,
    idleMarquee: typeof v.idleMarquee === 'string' && v.idleMarquee.trim() ? v.idleMarquee.slice(0, 500) : defaults.idleMarquee,
    speed: Number.isFinite(Number(v.speed)) ? Math.min(60, Math.max(10, Number(v.speed))) : defaults.speed,
    colorA: /^#[0-9a-f]{6}$/i.test(v.colorA) && !['#2563eb', '#a0eade', '#baffdf'].includes(v.colorA.toLowerCase()) ? v.colorA : defaults.colorA,
    colorB: /^#[0-9a-f]{6}$/i.test(v.colorB) && !['#15803d', '#93ff96'].includes(v.colorB.toLowerCase()) ? v.colorB : defaults.colorB,
    ...Object.fromEntries(['displayBgA', 'displayBgB', 'displayTextA', 'displayTextB', 'displayPulseA', 'displayPulseB', 'waitingCardColor', 'marqueeColor'].map(key => [key, /^#[0-9a-f]{6}$/i.test(v[key]) ? v[key] : defaults[key]])),
  };
}
export function readSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem('otepc-settings'))); }
  catch { return { ...defaults }; }
}
export function announcementText(template, queue, settings = {}) {
  const named = namedQueue(queue, groupLabels(settings));
  const digits = (named.canonical_queue_number || named.queue_number).match(/\d{3,}$/)?.[0];
  const name = groupLabels(settings)[named.service_group];
  const spoken = digits && name ? `${name} ${digits.split('').join(' ')}` : named.queue_number;
  return template.replaceAll('{q}', spoken).replaceAll('{counter}', 'จุดบริการหลัก');
}
export function bangkokDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function textColor(hex) {
  const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#000000' : '#ffffff';
}

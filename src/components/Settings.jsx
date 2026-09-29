import { useState } from 'react';
import { Volume2, Palette, MessageSquare, Save, Check, Play } from 'lucide-react';
import { defaults, normalizeSettings, groups } from '../lib/queue';
import { fetchCloudQueueAudio } from '../services/cloudTts';

export default function Settings({ settings, queues = [], onSave, onError }) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const change = (key, value) => { setSaved(false); setDraft(d => ({ ...d, [key]: value })); };

  function save(e) {
    e.preventDefault();
    if (draft.announcement.trim().split('{q}').length !== 2) {
      onError('รูปแบบเสียงประกาศต้องมี {q} หนึ่งตำแหน่งสำหรับหมายเลขคิว');
      return;
    }
    try { onSave(normalizeSettings(draft)); setSaved(true); }
    catch { onError('ไม่สามารถบันทึกได้ กรุณาอนุญาตให้เบราว์เซอร์ใช้ localStorage'); }
  }

  async function testVoice() {
    setVoiceNotice('');
    if (!draft.sound) { setVoiceNotice('กรุณาเปิดเสียงประกาศก่อนทดสอบ'); return; }
    const current = queues.find(queue => queue.status === 'calling');
    if (!current) { setVoiceNotice('กรุณาเรียกคิวหนึ่งหมายเลขก่อนทดสอบเสียง Google Cloud'); return; }
    setVoiceNotice(`กำลังขอเสียง Google Cloud สำหรับ ${current.queue_number}`);
    let url;
    try {
      const blob = await fetchCloudQueueAudio(current, draft.announcement);
      url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = draft.ttsVolume;
      audio.playbackRate = draft.ttsRate / 0.9;
      audio.onended = () => { URL.revokeObjectURL(url); setVoiceNotice(`ทดสอบเสียง Google Cloud ${current.queue_number} สำเร็จ`); };
      audio.onerror = () => { URL.revokeObjectURL(url); setVoiceNotice('เล่นไฟล์เสียง Google Cloud ไม่ได้ กรุณาตรวจสอบอุปกรณ์เสียง'); };
      await audio.play();
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      setVoiceNotice(error.message || 'เชื่อม Google Cloud TTS ไม่สำเร็จ');
    }
  }
  return <><div className="page-heading"><div><h1>ปรับแต่ง<span className="text-blue-600">การให้บริการ</span></h1><p>ตั้งค่าเสียง ข้อความ และสี ให้เหมาะกับจุดบริการของคุณ</p></div><span className="small-note">การตั้งค่าสำหรับเบราว์เซอร์นี้</span></div>
    <form onSubmit={save} className="settings-grid mt-7"><section className="panel p-6"><h2 className="settings-title"><MessageSquare /> ข้อความและประกาศ</h2><label className="field mt-6">ข้อความวิ่งประชาสัมพันธ์<textarea rows={4} maxLength={500} required value={draft.marquee} onChange={e => change('marquee', e.target.value)} /></label><label className="field mt-5">ข้อความเมื่อยังไม่มีคิวถูกเรียก<textarea rows={2} maxLength={500} required value={draft.idleMarquee} onChange={e => change('idleMarquee', e.target.value)} /></label><label className="field mt-5">รูปแบบเสียงประกาศ<textarea rows={3} maxLength={200} required value={draft.announcement} onChange={e => change('announcement', e.target.value)} /></label><p className="text-xs text-slate-400 mt-2">ใส่ {'{q}'} หนึ่งตำแหน่งแทนหมายเลขคิว เช่น ขอเชิญหมายเลขคิว {'{q}'} ที่ห้องประชุมค่ะ</p><label className="field mt-6">ระยะเวลาข้อความวิ่ง: {draft.speed} วินาที<input type="range" min="10" max="60" value={draft.speed} onChange={e => change('speed', Number(e.target.value))} /><span className="flex justify-between text-xs text-slate-400"><span>เร็ว</span><span>ช้า</span></span></label></section>
    <div className="space-y-6"><section className="panel p-6"><h2 className="settings-title"><Volume2 /> เสียงระบบ</h2><div className="flex items-center justify-between gap-5 mt-6"><div><p>เสียงประกาศหมายเลขคิว</p><p className="text-sm text-slate-400 mt-1">อ่านหมายเลขทีละตัว เช่น A 0 0 1</p></div><button type="button" role="switch" aria-checked={draft.sound} aria-label="เสียงประกาศหมายเลขคิว" className={`toggle ${draft.sound ? 'on' : ''}`} onClick={() => change('sound', !draft.sound)}><span /></button></div>
      <div className="field mt-6"><span>เสียงภาษาไทย</span><p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 font-semibold text-blue-800">Google Cloud — ไทยผู้หญิง Standard-A</p></div>
      <p role="status" className="text-sm text-amber-700 mt-3">เสียง Cloud ใช้ข้อความในช่องรูปแบบเสียงประกาศ ต้องตั้งค่า Google Service Account Secret ใน Supabase ก่อนใช้งาน</p>
      <label className="field mt-5">ความเร็วเสียง: {draft.ttsRate.toFixed(2)}<input type="range" min="0.5" max="1.5" step="0.05" value={draft.ttsRate} onChange={e => change('ttsRate', Number(e.target.value))} /></label>
      <label className="field mt-5">ความดังเสียง: {Math.round(draft.ttsVolume * 100)}%<input type="range" min="0" max="100" step="1" value={Math.round(draft.ttsVolume * 100)} onChange={e => change('ttsVolume', Number(e.target.value) / 100)} /></label>
      <button type="button" className="secondary-button mt-5" onClick={testVoice}><Play size={18} /> ทดสอบเสียงบนเครื่องนี้</button>
      {voiceNotice && <p role="status" className="text-sm text-slate-600 mt-3">{voiceNotice}</p>}
      <p className="text-xs text-slate-400 mt-4">เลือกและทดสอบบน Chrome ของเครื่องจอแสดงผล แล้วกดบันทึก การตั้งค่าเสียงเก็บในเบราว์เซอร์เครื่องนั้น</p>
    </section><section className="panel p-6"><h2 className="settings-title"><Palette /> สีประจำกลุ่มบริการ</h2><div className="space-y-5 mt-6">{Object.entries(groups).map(([k, v]) => <label key={k} className="flex items-center justify-between"><span>{v} ({k})</span><span className="flex items-center gap-3"><code className="text-xs text-slate-400">{draft[`color${k}`]}</code><input aria-label={`สี${v}`} type="color" value={draft[`color${k}`]} onChange={e => change(`color${k}`, e.target.value)} /></span></label>)}</div><div className="border-t border-slate-200 mt-6 pt-5"><h3 className="font-medium">สีบนจอแสดงผล</h3>{[['A', 'กลุ่มทั่วไป'], ['B', 'กลุ่มประสบการณ์']].map(([group, label]) => <div key={group} className="mt-4 rounded-xl border border-slate-200 p-4"><strong>{label} ({group})</strong><div className="grid sm:grid-cols-3 gap-3 mt-3">{[['displayBg', 'สีพื้นหลัง'], ['displayText', 'สีตัวอักษร'], ['displayPulse', 'สีกระพริบ']].map(([field, text]) => <label key={field} className="field">{text}<input aria-label={`${text} ${group}`} type="color" value={draft[`${field}${group}`]} onChange={e => change(`${field}${group}`, e.target.value)} /></label>)}</div></div>)}<div className="grid sm:grid-cols-2 gap-3 mt-4">{[['waitingCardColor', 'สีการ์ดจำนวนคิวรอ'], ['marqueeColor', 'สีข้อความวิ่ง']].map(([field, label]) => <label key={field} className="field">{label}<input aria-label={label} type="color" value={draft[field]} onChange={e => change(field, e.target.value)} /></label>)}</div></div><button className="text-sm text-blue-600 mt-6 underline underline-offset-4" type="button" onClick={() => { setDraft({ ...defaults }); setSaved(false); }}>คืนค่าเริ่มต้น</button></section></div>
    <div className="settings-actions flex items-center justify-end gap-4"><span role="status" className="text-sm text-emerald-600">{saved ? 'บันทึกการตั้งค่าแล้ว' : ''}</span><button className="primary-button" type="submit">{saved ? <Check size={18} /> : <Save size={18} />} บันทึกการตั้งค่า</button></div></form>
  </>;
}

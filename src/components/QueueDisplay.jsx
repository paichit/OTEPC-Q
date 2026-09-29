import { useEffect, useState } from 'react';
import { Volume2, MonitorPlay, Maximize, Minimize } from 'lucide-react';
import { textColor } from '../lib/queue';

export default function QueueDisplay({ queues, settings, started, starting, onStart, onStop, speechError }) {
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [screenError, setScreenError] = useState('');
  useEffect(() => () => onStop(), [onStop]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const current = queues.find(q => q.status === 'calling');
  const waiting = queues.filter(q => q.status === 'waiting');
  const group = current?.service_group || 'A';
  const marquee = current ? settings.marquee.replaceAll('{q}', current.queue_number).replaceAll('{counter}', 'จุดบริการหลัก') : settings.idleMarquee;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setScreenError('');
    } catch { setScreenError('ไม่สามารถเปิดเต็มจอได้บนเบราว์เซอร์นี้'); }
  }
  return <div className="prototype-display">
    {(speechError || screenError) && <p role="status" className="info-box m-4">{speechError || screenError}</p>}
    <div className="prototype-display-grid">
      <section className="prototype-display-current" key={current ? `${current.id}-${current.called_at}` : 'empty'} style={{ background: settings[`displayBg${group}`], color: settings[`displayText${group}`], '--pulse-color': settings[`displayPulse${group}`] }}>
        <button className="fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'ออกจากโหมดเต็มจอ' : 'เปิดเต็มจอ'} title={fullscreen ? 'ออกจากโหมดเต็มจอ' : 'เปิดเต็มจอ'}>{fullscreen ? <Minimize /> : <Maximize />}</button>
        <h1>คิวปัจจุบัน / Current Queue</h1>
        <div className={current ? 'prototype-current-number new-call' : 'prototype-current-number'}>{current?.queue_number || '—'}</div>
      </section>
      <aside className="prototype-display-side"><div className="prototype-waiting-total" style={{ background: settings.waitingCardColor, color: textColor(settings.waitingCardColor) }}><h2>จำนวนคิวรอทั้งหมด</h2><strong>{waiting.length}</strong></div><div className="prototype-next"><h2>คิวถัดไป / Next</h2>{waiting.length ? waiting.slice(0, 5).map((q, i) => <div key={q.id} className="prototype-next-row" style={{ background: settings[`color${q.service_group}`], color: textColor(settings[`color${q.service_group}`]) }}><span>คิวที่ {i + 1}</span><strong>{q.queue_number}</strong></div>) : <p className="empty-state">ไม่มีคิวรอ</p>}</div></aside>
    </div>
    <div className="prototype-marquee"><div className="marquee-window"><p style={{ animationDuration: `${settings.speed}s`, color: settings.marqueeColor }}>{marquee}</p></div></div>
    {!started && <div className="start-overlay"><div className="start-card"><span className="login-icon"><MonitorPlay size={35} /></span><h2 className="text-2xl font-semibold mt-5">เชื่อมต่อระบบเสียงประกาศ</h2><p className="text-slate-500 my-4">คลิกหนึ่งครั้งเพื่อเริ่มจอแสดงผลและฟังเสียงยืนยัน “ระบบเสียงประกาศพร้อมใช้งานค่ะ”</p>{speechError && <p role="alert" className="text-red-600 mb-3">{speechError}</p>}<button className="primary-button w-full" onClick={onStart} disabled={starting}><Volume2 size={20} /> {starting ? 'กำลังเชื่อมต่อเสียง…' : 'เริ่มระบบและเปิดเสียง'}</button></div></div>}
  </div>;
}

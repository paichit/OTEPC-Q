import { useEffect, useState } from 'react';
import { Volume2, MonitorPlay, Maximize, Minimize } from 'lucide-react';
import { textColor } from '../lib/queue';
import { groupLabels } from '../lib/groups';
import { groupQueues } from '../lib/groupQueues';

export default function QueueDisplay({ queues, settings, started, starting, onStart, onStop, speechError }) {
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [screenError, setScreenError] = useState('');
  useEffect(() => () => onStop(), [onStop]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const groups = groupLabels(settings);
  const current = queues.filter(q => q.status === 'calling');
  const marquee = current.length ? settings.marquee.replaceAll('{q}', current.map(q => q.queue_number).join(' / ')).replaceAll('{counter}', 'ห้องประชุม') : settings.idleMarquee;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setScreenError('');
    } catch { setScreenError('ไม่สามารถเปิดเต็มจอได้บนเบราว์เซอร์นี้'); }
  }
  return <div className="prototype-display">
    {(speechError || screenError) && <p role="status" className="info-box m-4">{speechError || screenError}</p>}
    <button className="fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'ออกจากโหมดเต็มจอ' : 'เปิดเต็มจอ'} title={fullscreen ? 'ออกจากโหมดเต็มจอ' : 'เปิดเต็มจอ'}>{fullscreen ? <Minimize /> : <Maximize />}</button>
    <div className="prototype-display-grid prototype-group-grid">
      {['A', 'B'].map(group => {
        const { current: groupCurrent, waiting } = groupQueues(queues, group);
        return <section className="prototype-display-group" key={group} data-group={group} aria-label={`จอแสดงคิว${groups[group]}`}>
          <h1 className="prototype-group-heading" style={{ background: settings[`color${group}`], color: textColor(settings[`color${group}`]) }}>{groups[group]}</h1>
          <div className="prototype-display-current" style={{ background: settings[`displayBg${group}`], color: settings[`displayText${group}`], '--pulse-color': settings[`displayPulse${group}`] }}>
            <h2>คิวปัจจุบัน / Current Queue</h2>
            <div key={groupCurrent ? `${groupCurrent.id}-${groupCurrent.called_at}` : 'empty'} className={`prototype-current-number${groupCurrent ? ' new-call' : ''}${groupCurrent?.queue_number?.length > 8 ? ' long-number' : ''}`}>{groupCurrent?.queue_number || '—'}</div>
          </div>
          <aside className="prototype-display-side"><div className="prototype-waiting-total" style={{ background: settings.waitingCardColor, color: textColor(settings.waitingCardColor) }}><h2>จำนวนคิวรอทั้งหมด</h2><strong>{waiting.length}</strong></div><div className="prototype-next"><h2>คิวถัดไป / Next</h2>{waiting.length ? waiting.slice(0, 5).map((q, i) => <div key={q.id} className="prototype-next-row" style={{ background: settings[`color${group}`], color: textColor(settings[`color${group}`]) }}><span>คิวที่ {i + 1}</span><strong className={q.queue_number.length > 8 ? 'long-number' : ''}>{q.queue_number}</strong></div>) : <p className="empty-state">ไม่มีคิวรอ</p>}</div></aside>
        </section>;
      })}
    </div>
    <div className="prototype-marquee"><div className="marquee-window"><p style={{ animationDuration: `${settings.speed}s`, color: settings.marqueeColor }}>{marquee}</p></div></div>
    {!started && <div className="start-overlay"><div className="start-card"><span className="login-icon"><MonitorPlay size={35} /></span><h2 className="text-2xl font-semibold mt-5">เชื่อมต่อระบบเสียงประกาศ</h2><p className="text-slate-500 my-4">คลิกหนึ่งครั้งเพื่อเริ่มจอแสดงผลและฟังเสียงยืนยัน “ระบบเสียงประกาศพร้อมใช้งานค่ะ”</p>{speechError && <p role="alert" className="text-red-600 mb-3">{speechError}</p>}<button className="primary-button w-full" onClick={onStart} disabled={starting}><Volume2 size={20} /> {starting ? 'กำลังเชื่อมต่อเสียง…' : 'เริ่มระบบและเปิดเสียง'}</button></div></div>}
  </div>;
}

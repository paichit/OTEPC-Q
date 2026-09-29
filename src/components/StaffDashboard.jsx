import { useEffect, useState } from 'react';
import { Headphones, ArrowRight, RotateCcw, LogOut, LoaderCircle, LockKeyhole, Megaphone, Ban, History } from 'lucide-react';
import { getStaffSession, isConfigured, signInStaff, signOutStaff, staffRpc } from '../supabaseClient';
import { groups } from '../lib/queue';
import useAction from '../hooks/useAction';
import Modal from './Modal';

const time = value => value ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';
const queueDateTime = value => value ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';

function HistoryRecord({ record }) {
  const cancelled = record.status === 'cancelled';
  return <details className="border border-slate-200 rounded-xl p-3">
    <summary className="cursor-pointer flex justify-between gap-3">
      <span><strong>{record.queue_number}</strong> <small className="text-slate-500">{record.queue_date}</small></span>
      <span className={cancelled ? 'text-orange-600 font-semibold' : 'text-blue-700'}>
        {cancelled ? 'ยกเลิกคิว' : `เรียก ${record.call_count} ครั้ง`}
      </span>
    </summary>
    {cancelled
      ? <p className="mt-3 text-sm text-orange-700">ยกเลิกเวลา {time(record.cancelled_at)}</p>
      : <ol className="mt-3 text-sm text-slate-600 space-y-1">{record.events.map((event, index) => <li key={`${event.called_at}-${index}`}>{index + 1}. {event.event_kind === 'recall' ? 'เรียกซ้ำ' : 'เรียกครั้งแรก'} · {time(event.called_at)}</li>)}</ol>}
  </details>;
}

export default function StaffDashboard({ queues, refresh, onError }) {
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);
  const [cancelQueue, setCancelQueue] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyScope, setHistoryScope] = useState('all');
  const [notice, setNotice] = useState('');
  const { busy, run } = useAction(onError);
  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    getStaffSession().then(data => { if (alive) setSession(data); }).catch(onError);
    const expired = () => setSession(null);
    window.addEventListener('otepc-staff-expired', expired);
    return () => { alive = false; window.removeEventListener('otepc-staff-expired', expired); };
  }, []);
  const authorized = Boolean(session?.username);
  const current = queues.find(q => q.status === 'calling');
  const waiting = queues.filter(q => q.status === 'waiting');
  const columns = [
    { title: 'กำลังรอ', status: ['waiting'], tone: 'amber' },
    { title: 'ประวัติล่าสุด', status: ['completed', 'skipped', 'cancelled'], tone: 'green' },
  ];
  function next() {
    run(async () => {
      setNotice('');
      const result = await staffRpc('call_next', { p_expected: current?.id ?? null });
      if (!result) setNotice('ยังไม่มีคิวรอ คิวปัจจุบันยังคงเปิดอยู่');
      await refresh();
    });
  }
  function recall() {
    if (!current) return;
    run(async () => { await staffRpc('recall_current', { p_expected: current.id }); await refresh(); });
  }
  function showHistory() {
    run(async () => {
      setHistoryScope('all');
      setHistory(await staffRpc('queue_call_history'));
    });
  }
  function showCurrentHistory() {
    run(async () => {
      setHistoryScope('current');
      setHistory(await staffRpc('queue_call_history_current'));
    });
  }
  if (!authorized) return <div className="login-card panel"><span className="login-icon"><LockKeyhole size={30} /></span><h1 className="text-2xl font-semibold mt-5">พื้นที่สำหรับเจ้าหน้าที่</h1><p className="text-slate-500 mt-2 mb-6">เข้าสู่ระบบเพื่อเรียก ยกเลิก และรีเซ็ตคิว</p>
    <form className="space-y-4 text-left" onSubmit={e => { e.preventDefault(); run(async () => { const data = await signInStaff(username, password); setSession(data); setPassword(''); }); }}>
      <label className="field">ชื่อผู้ใช้<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} required value={username} onChange={e => setUsername(e.target.value)} /></label><label className="field">รหัสผ่าน<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary-button w-full" disabled={busy || !isConfigured}>{busy && <LoaderCircle size={18} className="animate-spin" />} เข้าสู่ระบบ</button>
    </form>
  </div>;
  return <>
    <div className="page-heading"><div className="page-heading-copy"><h1>จัดการคิว <span className="text-blue-600">อย่างเป็นระบบ</span></h1><p>จุดเรียกคิวเดียว เรียกผู้รับคิวตามลำดับเวลาที่รับคิว ไม่แยกกลุ่ม</p></div><div className="page-heading-account"><span className="section-label"><span /> STAFF WORKSPACE · {session.username}</span><button className="secondary-button page-heading-action" disabled={busy} onClick={() => run(async () => { await signOutStaff(); setSession(null); })}><LogOut size={17} /> ออกจากระบบ</button></div></div>
    <div className="staff-toolbar my-5"><div className="staff-history-actions"><button className="secondary-button staff-current-history-button" disabled={busy} onClick={showCurrentHistory}><History size={17} /> ประวัติรอบปัจจุบัน</button><button className="secondary-button staff-all-history-button" disabled={busy} onClick={showHistory}><History size={17} /> ประวัติการเรียก</button></div><section className="staff-queue-summary panel" aria-label="สรุปจุดเรียกคิว"><Headphones className="staff-summary-icon" size={23} /><strong>จุดเรียกคิวหลัก</strong><span className="staff-summary-stat staff-summary-total">คิวรอทั้งหมด <b>{waiting.length}</b></span><span className="staff-summary-stat staff-summary-group-a">กลุ่ม A <b>{waiting.filter(q => q.service_group === 'A').length}</b></span><span className="staff-summary-stat staff-summary-group-b">กลุ่ม B <b>{waiting.filter(q => q.service_group === 'B').length}</b></span></section><button className="danger-button staff-reset-button" disabled={busy} onClick={() => setReset(true)}><RotateCcw size={17} /> รีเซ็ตคิวของวันนี้</button></div>
    {notice && <p role="status" className="info-box mt-4">{notice}</p>}
    <div className="staff-grid mt-6"><div className="current-counter staff-current panel"><div><p className="text-lg text-slate-500">หมายเลขคิวปัจจุบัน</p><strong className="staff-current-number" style={{ color: current?.service_group === 'B' ? '#16a34a' : '#2563eb' }}>{current?.queue_number || '—'}</strong>{current ? <p className="text-sm text-slate-500 mt-2">เรียกเวลา {time(current.called_at)} · เรียกแล้ว {current.call_count || 1} ครั้ง</p> : <p className="text-sm text-slate-500 mt-2">ยังไม่มีคิวที่เรียก</p>}</div><div className="staff-current-actions"><button className="light-button staff-action-recall" disabled={busy || !current} onClick={recall}>{busy ? <LoaderCircle size={19} className="animate-spin" /> : <Megaphone size={19} />} เรียกซ้ำ</button><button className="light-button staff-action-next" disabled={busy} onClick={next}>{busy ? <LoaderCircle size={19} className="animate-spin" /> : <ArrowRight size={19} />} เรียกคิวถัดไป</button></div></div>{columns.map(column => {
      let items = queues.filter(q => column.status.includes(q.status));
      if (column.tone === 'green') items = items.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 50);
      return <section className="panel queue-column" key={column.title}><div className="column-title"><h2>{column.title}</h2><span className={`count-badge ${column.tone}`}>{items.length} คิว</span></div><div className="queue-list">{items.length ? items.map(q => { const dateTime = q.status === 'waiting' ? q.created_at : q.status === 'cancelled' ? q.cancelled_at || q.updated_at : q.called_at || q.updated_at; const timeLabel = q.status === 'waiting' ? 'รับคิว' : q.status === 'cancelled' ? 'ยกเลิก' : 'เรียกคิว'; const statusLabel = q.status === 'waiting' ? 'รอเข้ารับเรียกคิว' : q.status === 'cancelled' ? 'ยกเลิกแล้ว' : q.status === 'completed' ? 'เรียกคิวเสร็จแล้ว' : 'กำลังเรียก'; return <div key={q.id} className={`queue-row queue-row-${q.service_group.toLowerCase()} queue-row-${q.status}`}><div><strong>{q.queue_number}</strong><small className="block">{statusLabel}{q.status === 'waiting' && <span className="queue-row-datetime-inline"> · รับคิว {queueDateTime(dateTime)}</span>}{Number(q.call_count) > 0 ? ` · เรียก ${q.call_count} ครั้ง` : ''}</small></div><div className="text-right"><p className="text-sm">{groups[q.service_group]}</p>{q.status === 'waiting' ? <button className="queue-cancel-action mt-1" disabled={busy} onClick={() => setCancelQueue(q)}><Ban size={15} /> ยกเลิกคิว</button> : <small className="queue-row-datetime block">{timeLabel} {queueDateTime(dateTime)}</small>}</div></div>; }) : <p className="empty-state">ยังไม่มีรายการคิว</p>}</div>{column.tone === 'green' && <p className="text-xs text-slate-400 p-4 border-t border-slate-100">ประวัติล่าสุดไม่เกิน 50 รายการ · ดูทั้งหมดของรอบนี้ได้ที่ปุ่มประวัติรอบปัจจุบัน</p>}</section>;
    })}</div>
    {cancelQueue && <Modal title={`ยกเลิกคิว ${cancelQueue.queue_number}?`} onClose={() => setCancelQueue(null)} busy={busy}><p className="text-slate-500">ยกเลิกได้เฉพาะคิวที่กำลังรอ ระบบจะเก็บรายการไว้ในประวัติของวันนี้</p><div className="flex gap-3 mt-6"><button className="secondary-button flex-1" disabled={busy} onClick={() => setCancelQueue(null)} >กลับ</button><button className="danger-button flex-1" disabled={busy} onClick={() => run(async () => { await staffRpc('cancel_waiting', { p_queue_id: cancelQueue.id }); setCancelQueue(null); await refresh(); })}>{busy && <LoaderCircle size={17} className="animate-spin" />} ยืนยันยกเลิก</button></div></Modal>}
    {reset && <Modal title="รีเซ็ตคิวของวันนี้?" onClose={() => setReset(false)} busy={busy}><p className="text-slate-500 leading-7">คิวทุกกลุ่มของวันนี้ รวมถึงคิวที่กำลังเรียก จะถูกลบ และเริ่มเลขคิวใหม่ที่ A001 / B001 ประวัติการเรียกที่บันทึกไว้ยังดูย้อนหลังได้</p><div className="flex gap-3 mt-6"><button className="secondary-button flex-1" disabled={busy} onClick={() => setReset(false)}>กลับ</button><button className="danger-button flex-1" disabled={busy} onClick={() => run(async () => { await staffRpc('reset_today'); setReset(false); await refresh(); })}>{busy && <LoaderCircle size={17} className="animate-spin" />} ยืนยันรีเซ็ต</button></div></Modal>}
    {history && <Modal title={historyScope === 'current' ? 'ประวัติการเรียกและยกเลิก · รอบปัจจุบัน' : 'ประวัติการเรียกทั้งหมด'} onClose={() => setHistory(null)}><p className="text-sm text-slate-500 mb-4">{historyScope === 'current' ? 'แสดงคิวที่เรียกและยกเลิกในรอบปัจจุบัน รอบที่รีเซ็ตไปแล้วจะไม่แสดงที่นี่' : 'รวมประวัติทุกช่วงเวลา ทั้งรอบปัจจุบันและรอบก่อนหน้า'}</p><div className="max-h-[55vh] overflow-auto space-y-3">{history.length ? history.map(q => <HistoryRecord key={q.queue_id} record={q} />) : <p className="empty-state">ยังไม่มีประวัติการเรียก</p>}</div></Modal>}
  </>;
}

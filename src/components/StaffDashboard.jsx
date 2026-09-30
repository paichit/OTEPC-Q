import { useEffect, useState } from 'react';
import { Headphones, ArrowRight, RotateCcw, LogOut, LoaderCircle, LockKeyhole, Megaphone, Ban, History, Eye, EyeOff, Download, Undo2 } from 'lucide-react';
import { getStaffSession, isConfigured, signInStaff, signOutStaff, staffRpc } from '../supabaseClient';
import { groupLabels, namedQueue } from '../lib/groups';
import { reportCsv } from '../lib/report';
import useAction from '../hooks/useAction';
import Modal from './Modal';

const time = value => value ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';
const queueDateTime = value => value ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';

function HistoryRecord({ record: rawRecord, names }) {
  const record = namedQueue(rawRecord, names);
  const cancelled = record.status === 'cancelled';
  const restored = record.status === 'restored';
  return <details className="border border-slate-200 rounded-xl p-3">
    <summary className="cursor-pointer flex justify-between gap-3">
      <span><strong>{record.queue_number}</strong> <small className="text-slate-500">{record.queue_date}</small></span>
      <span className={cancelled ? 'text-orange-600 font-semibold' : restored ? 'text-emerald-700 font-semibold' : 'text-blue-700'}>
        {cancelled ? 'ยกเลิกคิว' : restored ? 'คืนคิว' : `เรียก ${record.call_count} ครั้ง`}
      </span>
    </summary>
    {cancelled
      ? <p className="mt-3 text-sm text-orange-700">ยกเลิกเวลา {time(record.cancelled_at)}</p>
      : restored
        ? <p className="mt-3 text-sm text-emerald-700">คืนคิวเวลา {time(record.restored_at)} · กลับไปรอท้ายแถวด้วยเลขเดิม</p>
      : <ol className="mt-3 text-sm text-slate-600 space-y-1">{record.events.map((event, index) => <li key={`${event.called_at}-${index}`}>{index + 1}. {event.event_kind === 'recall' ? 'เรียกซ้ำ' : 'เรียกครั้งแรก'} · {time(event.called_at)}</li>)}</ol>}
  </details>;
}

export default function StaffDashboard({ queues, settings, refresh, onError }) {
  const groups = groupLabels(settings);
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reset, setReset] = useState(false);
  const [cancelQueue, setCancelQueue] = useState(null);
  const [restoreQueue, setRestoreQueue] = useState(null);
  const [cancelledList, setCancelledList] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportFormat, setReportFormat] = useState('xlsx');
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
  function exportReport(group = null) {
    run(async () => {
      const rows = await staffRpc('queue_report', { p_from: reportFrom || null, p_to: reportTo || null });
      let blob;
      if (reportFormat === 'xlsx') {
        const { reportXlsx } = await import('../lib/reportXlsx');
        blob = await reportXlsx(rows, group, groups);
      } else if (reportFormat === 'pdf') {
        const { reportPdf } = await import('../lib/reportPdf');
        blob = await reportPdf(rows, group, reportFrom, reportTo, groups);
      } else {
        blob = new Blob([reportCsv(rows, group, groups)], { type: 'text/csv;charset=utf-8' });
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `otepc-queue-report-${group || 'all'}-${reportFrom || 'all'}-${reportTo || 'all'}.${reportFormat}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function showCancelled() {
    run(async () => setCancelledList((await staffRpc('cancelled_queues_current')).map(queue => namedQueue(queue, groups))));
  }
  if (!authorized) return <div className="login-card panel"><span className="login-icon"><LockKeyhole size={30} /></span><h1 className="text-2xl font-semibold mt-5">พื้นที่สำหรับเจ้าหน้าที่</h1><p className="text-slate-500 mt-2 mb-6">เข้าสู่ระบบเพื่อเรียก ยกเลิก และรีเซ็ตคิว</p>
    <form className="space-y-4 text-left" onSubmit={e => { e.preventDefault(); run(async () => { const data = await signInStaff(username, password); setSession(data); setPassword(''); }); }}>
      <label className="field">ชื่อผู้ใช้<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} required value={username} onChange={e => setUsername(e.target.value)} /></label><label className="field">รหัสผ่าน<span className="password-input-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button className="password-visibility" type="button" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword} onClick={() => setShowPassword(show => !show)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label><button className="primary-button w-full" disabled={busy || !isConfigured}>{busy && <LoaderCircle size={18} className="animate-spin" />} เข้าสู่ระบบ</button>
    </form>
  </div>;
  return <>
    <div className="page-heading"><div className="page-heading-copy"><h1>จัดการคิว <span className="text-blue-600">อย่างเป็นระบบ</span></h1><p>จุดเรียกคิวเดียว เรียกผู้รับคิวตามลำดับเวลาที่รับคิว ไม่แยกกลุ่ม</p></div><div className="page-heading-account"><span className="section-label"><span /> STAFF WORKSPACE · {session.username}</span><button className="secondary-button page-heading-action" disabled={busy} onClick={() => run(async () => { await signOutStaff(); setSession(null); })}><LogOut size={17} /> ออกจากระบบ</button></div></div>
    <div className="staff-toolbar my-5"><div className="staff-history-actions"><button className="secondary-button staff-current-history-button" disabled={busy} onClick={showCurrentHistory}><History size={17} /> ประวัติรอบปัจจุบัน</button><button className="secondary-button staff-all-history-button" disabled={busy} onClick={showHistory}><History size={17} /> ประวัติการเรียก</button><button className="secondary-button staff-restore-list-button" disabled={busy} onClick={showCancelled}><Undo2 size={17} /> คืนคิวที่ยกเลิก</button><button className="secondary-button staff-report-button" disabled={busy} onClick={() => setReportOpen(true)}><Download size={17} /> ส่งออกรายงาน</button></div><section className="staff-queue-summary panel" aria-label="สรุปจุดเรียกคิว"><Headphones className="staff-summary-icon" size={23} /><strong>จุดเรียกคิวหลัก</strong><span className="staff-summary-stat staff-summary-total">คิวรอทั้งหมด <b>{waiting.length}</b></span><span className="staff-summary-stat staff-summary-group-a" style={{ '--group-color': settings.colorA }}>{groups.A} <b>{waiting.filter(q => q.service_group === 'A').length}</b></span><span className="staff-summary-stat staff-summary-group-b" style={{ '--group-color': settings.colorB }}>{groups.B} <b>{waiting.filter(q => q.service_group === 'B').length}</b></span></section><button className="danger-button staff-reset-button" disabled={busy} onClick={() => setReset(true)}><RotateCcw size={17} /> รีเซ็ตคิวของวันนี้</button></div>
    {notice && <p role="status" className="info-box mt-4">{notice}</p>}
    <div className="staff-grid mt-6"><div className="current-counter staff-current panel"><div><p className="text-lg text-slate-500">หมายเลขคิวปัจจุบัน</p><strong style={{ color: '#000000' }} className={current?.queue_number?.length > 8 ? 'staff-current-number long-number' : 'staff-current-number'}>{current?.queue_number || '—'}</strong>{current ? <p className="text-sm text-slate-500 mt-2">เรียกเวลา {time(current.called_at)} · เรียกแล้ว {current.call_count || 1} ครั้ง</p> : <p className="text-sm text-slate-500 mt-2">ยังไม่มีคิวที่เรียก</p>}</div><div className="staff-current-actions"><button className="light-button staff-action-recall" disabled={busy || !current} onClick={recall}>{busy ? <LoaderCircle size={19} className="animate-spin" /> : <Megaphone size={19} />} เรียกซ้ำ</button><button className="light-button staff-action-next" disabled={busy} onClick={next}>{busy ? <LoaderCircle size={19} className="animate-spin" /> : <ArrowRight size={19} />} เรียกคิวถัดไป</button></div></div>{columns.map(column => {
      let items = queues.filter(q => column.status.includes(q.status));
      if (column.tone === 'green') items = items.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 50);
      return <section className="panel queue-column" key={column.title}><div className="column-title"><h2>{column.title}</h2><span className={`count-badge ${column.tone}`}>{items.length} คิว</span></div><div className="queue-list">{items.length ? items.map(q => { const dateTime = q.status === 'waiting' ? q.created_at : q.status === 'cancelled' ? q.cancelled_at || q.updated_at : q.called_at || q.updated_at; const timeLabel = q.status === 'waiting' ? 'รับคิว' : q.status === 'cancelled' ? 'ยกเลิก' : 'เรียกคิว'; const statusLabel = q.status === 'waiting' ? 'รอเข้ารับเรียกคิว' : q.status === 'cancelled' ? 'ยกเลิกแล้ว' : q.status === 'completed' ? 'เรียกคิวเสร็จแล้ว' : 'กำลังเรียก'; return <div key={q.id} className={`queue-row queue-row-${q.service_group.toLowerCase()} queue-row-${q.status}`} style={{ background: settings[`color${q.service_group}`] }}><div><strong className={q.queue_number.length > 8 ? 'long-number' : ''}>{q.queue_number}</strong><small className="block">{statusLabel}{q.status === 'waiting' && <span className="queue-row-datetime-inline"> · รับคิว {queueDateTime(dateTime)}</span>}{Number(q.call_count) > 0 ? ` · เรียก ${q.call_count} ครั้ง` : ''}</small></div><div className="text-right"><p className="text-sm">{groups[q.service_group]}</p>{q.status === 'waiting' ? <button className="queue-cancel-action mt-1" disabled={busy} onClick={() => setCancelQueue(q)}><Ban size={15} /> ยกเลิกคิว</button> : q.status === 'cancelled' ? <button className="queue-restore-action mt-1" disabled={busy} onClick={() => setRestoreQueue(q)}><Undo2 size={15} /> คืนคิว</button> : <small className="queue-row-datetime block">{timeLabel} {queueDateTime(dateTime)}</small>}</div></div>; }) : <p className="empty-state">ยังไม่มีรายการคิว</p>}</div>{column.tone === 'green' && <p className="text-xs text-slate-400 p-4 border-t border-slate-100">ประวัติล่าสุดไม่เกิน 50 รายการ · ดูทั้งหมดของรอบนี้ได้ที่ปุ่มประวัติรอบปัจจุบัน</p>}</section>;
    })}</div>
    {cancelQueue && <Modal title={`ยกเลิกคิว ${cancelQueue.queue_number}?`} onClose={() => setCancelQueue(null)} busy={busy}><p className="text-slate-500">ยกเลิกได้เฉพาะคิวที่กำลังรอ ระบบจะเก็บรายการไว้ในประวัติของวันนี้</p><div className="flex gap-3 mt-6"><button className="secondary-button flex-1" disabled={busy} onClick={() => setCancelQueue(null)} >กลับ</button><button className="danger-button flex-1" disabled={busy} onClick={() => run(async () => { await staffRpc('cancel_waiting', { p_queue_id: cancelQueue.id }); setCancelQueue(null); await refresh(); })}>{busy && <LoaderCircle size={17} className="animate-spin" />} ยืนยันยกเลิก</button></div></Modal>}
    {cancelledList && <Modal title="คิวที่ยกเลิก · รอบปัจจุบัน" onClose={() => setCancelledList(null)} busy={busy}><div className="max-h-[55vh] overflow-auto space-y-3">{cancelledList.length ? cancelledList.map(q => <div key={q.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><span><strong>{q.queue_number}</strong><small className="block text-slate-500">{groups[q.service_group]} · ยกเลิก {queueDateTime(q.cancelled_at)}</small></span><button className="secondary-button" disabled={busy} onClick={() => { setCancelledList(null); setRestoreQueue(q); }}>คืนคิว</button></div>) : <p className="empty-state">ไม่มีคิวที่ยกเลิกในรอบนี้</p>}</div></Modal>}
    {restoreQueue && <Modal title={`คืนคิว ${restoreQueue.queue_number}?`} onClose={() => setRestoreQueue(null)} busy={busy}><p className="text-slate-500">คิวนี้จะใช้เลขเดิมและกลับไปรอท้ายแถว หลังคิวที่รออยู่ทั้งหมด</p><div className="flex gap-3 mt-6"><button className="secondary-button flex-1" disabled={busy} onClick={() => setRestoreQueue(null)}>กลับ</button><button className="primary-button flex-1" disabled={busy} onClick={() => run(async () => { await staffRpc('restore_cancelled', { p_queue_id: restoreQueue.id }); setRestoreQueue(null); await refresh(); })}>{busy && <LoaderCircle size={17} className="animate-spin" />} ยืนยันคืนคิว</button></div></Modal>}
    {reportOpen && <Modal title="ส่งออกรายงานคิว" onClose={() => setReportOpen(false)} busy={busy}><p className="text-sm text-slate-500 mb-4">เลือกช่วงวันที่ รูปแบบไฟล์ และกลุ่มที่ต้องการ เว้นวันที่ว่างไว้เพื่อดูข้อมูลทุกวันที่มีบันทึก</p><div className="grid grid-cols-2 gap-3"><label className="field">ตั้งแต่วันที่<input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></label><label className="field">ถึงวันที่<input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} /></label></div><label className="field block mt-4">รูปแบบไฟล์<select value={reportFormat} onChange={e => setReportFormat(e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option><option value="pdf">PDF</option></select></label><div className="grid gap-3 mt-5"><button className="primary-button" disabled={busy || Boolean(reportFrom && reportTo && reportFrom > reportTo)} onClick={() => exportReport()}><Download size={17} /> ข้อมูลรวมทุกกลุ่ม</button><button className="secondary-button" disabled={busy || Boolean(reportFrom && reportTo && reportFrom > reportTo)} onClick={() => exportReport('A')}><Download size={17} /> เฉพาะ{groups.A}</button><button className="secondary-button" disabled={busy || Boolean(reportFrom && reportTo && reportFrom > reportTo)} onClick={() => exportReport('B')}><Download size={17} /> เฉพาะ{groups.B}</button></div></Modal>}
    {reset && <Modal title="รีเซ็ตคิวของวันนี้?" onClose={() => setReset(false)} busy={busy}><p className="text-slate-500 leading-7">คิวทุกกลุ่มของวันนี้ รวมถึงคิวที่กำลังเรียก จะถูกลบ และเริ่มเลขคิวใหม่ที่ {groups.A}001 / {groups.B}001 ประวัติการเรียกที่บันทึกไว้ยังดูย้อนหลังได้</p><div className="flex gap-3 mt-6"><button className="secondary-button flex-1" disabled={busy} onClick={() => setReset(false)}>กลับ</button><button className="danger-button flex-1" disabled={busy} onClick={() => run(async () => { await staffRpc('reset_today'); setReset(false); await refresh(); })}>{busy && <LoaderCircle size={17} className="animate-spin" />} ยืนยันรีเซ็ต</button></div></Modal>}
    {history && <Modal title={historyScope === 'current' ? 'ประวัติการเรียกและยกเลิก · รอบปัจจุบัน' : 'ประวัติการเรียกทั้งหมด'} onClose={() => setHistory(null)}><p className="text-sm text-slate-500 mb-4">{historyScope === 'current' ? 'แสดงคิวที่เรียกและยกเลิกในรอบปัจจุบัน รอบที่รีเซ็ตไปแล้วจะไม่แสดงที่นี่' : 'รวมประวัติทุกช่วงเวลา ทั้งรอบปัจจุบันและรอบก่อนหน้า'}</p><div className="max-h-[55vh] overflow-auto space-y-3">{history.length ? history.map(q => <HistoryRecord key={`${q.queue_id}-${q.status}-${q.cancelled_at || q.restored_at || q.last_called_at}`} record={q} names={groups} />) : <p className="empty-state">ยังไม่มีประวัติการเรียก</p>}</div></Modal>}
  </>;
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { Ticket, LayoutDashboard, Monitor, Settings as SettingsIcon, ArrowUpRight, WifiOff } from 'lucide-react';
import CustomerKiosk from './components/CustomerKiosk';
import BangkokClock from './components/BangkokClock';
import ViewBoundary from './components/ViewBoundary';
import Modal from './components/Modal';
import useQueues from './hooks/useQueues';
import useAnnouncements from './hooks/useAnnouncements';
import { groupLabels, namedQueue } from './lib/groups';
import { staffRpc } from './supabaseClient';
import { readSettings } from './lib/queue';

const StaffDashboard = lazy(() => import('./components/StaffDashboard'));
const QueueDisplay = lazy(() => import('./components/QueueDisplay'));
const Settings = lazy(() => import('./components/Settings'));
const tabs = [
  { id: 'kiosk', label: 'รับบัตรคิว', icon: Ticket },
  { id: 'staff', label: 'จัดการคิว', icon: LayoutDashboard },
  { id: 'display', label: 'จอแสดงคิว', icon: Monitor },
  { id: 'settings', label: 'ตั้งค่าระบบ', icon: SettingsIcon },
];

export default function App() {
  const [view, setView] = useState('kiosk');
  const [settings, setSettings] = useState(readSettings);
  const [error, setError] = useState('');
  const speech = useAnnouncements(settings.sound);
  const data = useQueues(speech.announce);

  useEffect(() => {
    const update = event => {
      if (event.key === 'otepc-settings' || event.key === null) setSettings(readSettings());
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  const sharedNames = data.group_names || groupLabels(settings);
  const effectiveSettings = { ...settings, groupNameA: sharedNames.A, groupNameB: sharedNames.B };
  const saveSettings = async value => {
    if (value.groupNameA !== sharedNames.A || value.groupNameB !== sharedNames.B) {
      await staffRpc('set_queue_group_names', { p_name_a: value.groupNameA, p_name_b: value.groupNameB });
      await data.refresh();
    }
    localStorage.setItem('otepc-settings', JSON.stringify(value));
    setSettings(value);
  };
  const waiting = data.queues.filter(q => q.status === 'waiting').length;
  const calling = data.queues.filter(q => q.status === 'calling').length;
  const props = { queues: data.queues.map(queue => namedQueue(queue, sharedNames)), settings: effectiveSettings, onError: setError, refresh: data.refresh, callingMode: data.calling_mode };

  return <div className={`app-shell app-shell-${view}`}>
    <header className="site-header"><div className="header-inner">
      <a href="#" onClick={event => { event.preventDefault(); setView('kiosk'); }} className="brand" aria-label="OTEPC Q หน้ารับคิว">
        <span className="brand-icon"><Ticket size={26} /></span>
        <div><strong>OTEPC <span>Q</span></strong><small>ระบบจัดคิวออนไลน์</small></div>
      </a>
      <nav aria-label="เมนูหลัก">{tabs.map(({ id, label, icon: Icon }) =>
        <button key={id} aria-current={view === id ? 'page' : undefined} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}>
          <Icon size={18} /><span>{label}</span>
        </button>
      )}</nav>
      <BangkokClock />
      <span className={`connection ${data.connection === 'live' ? 'connected' : ''}`} role="status"><span />
        {data.connection === 'live' ? 'เชื่อมต่อแล้ว' : data.connection === 'unconfigured' ? 'ยังไม่เชื่อมต่อ' : data.connection === 'connecting' ? 'กำลังเชื่อมต่อ' : 'ขาดการเชื่อมต่อ'}
      </span>
    </div></header>
    <main className={`main-content view-${view}`}>
      {data.connection === 'unconfigured' && <div className="info-box mb-6">พร้อมตั้งค่าระบบ — เพิ่ม Supabase URL และ Anon Key ใน .env.local แล้วรัน SQL ตาม README เพื่อเริ่มใช้งาน</div>}
      {(data.error || data.connection === 'offline') && <div className="error-box mb-6 flex flex-wrap items-center gap-3" role="status">
        <WifiOff size={18} /><span className="flex-1">{data.error || 'Realtime ขาดการเชื่อมต่อ ข้อมูลอาจยังไม่เป็นปัจจุบัน ระบบจะเชื่อมต่อใหม่อัตโนมัติ'}</span>
        <button onClick={data.refresh} className="underline">โหลดข้อมูลอีกครั้ง</button>
      </div>}
      <ViewBoundary key={view}><Suspense fallback={<p role="status" className="info-box">กำลังเปิดหน้าจอ…</p>}>
        {view === 'kiosk' && <CustomerKiosk {...props} />}
        {view === 'staff' && <StaffDashboard {...props} />}
        {view === 'display' && <QueueDisplay {...props} started={speech.started} starting={speech.starting} onStart={speech.start} onStop={speech.stop} speechError={speech.speechError} />}
        {view === 'settings' && <Settings settings={effectiveSettings} queues={data.queues} onSave={saveSettings} onError={setError} />}
      </Suspense></ViewBoundary>
      {view === 'kiosk' && <div className="summary-strip">
        <div><span className="summary-dot bg-blue-500" /><span>กำลังเรียกคิว</span><strong>{calling}</strong><small>คิว</small></div>
        <div><span className="summary-dot bg-amber-400" /><span>คิวที่รอทั้งหมด</span><strong>{waiting}</strong><small>คิว</small></div>
        <button onClick={() => setView('display')}>ดูหน้าจอแสดงคิว <ArrowUpRight size={17} /></button>
      </div>}
    </main>
    <footer className="site-footer"><span>OTEPC Q <span className="mx-2 text-slate-300">·</span> powered by กลุ่มเทคโนโลยีและสารสนเทศการบริหารงานบุคคล สำนักงาน ก.ค.ศ.</span><span>ระบบจัดคิวออนไลน์อัตโนมัติ</span></footer>
    {error && <Modal title="ไม่สามารถทำรายการได้" onClose={() => setError('')}>
      <p className="text-slate-500 leading-7 break-words">{error}</p><button className="primary-button w-full mt-6" onClick={() => setError('')}>รับทราบ</button>
    </Modal>}
  </div>;
}

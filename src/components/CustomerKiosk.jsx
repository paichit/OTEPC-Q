import { useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { rpc, isConfigured } from '../supabaseClient';
import { groupLabels, namedQueue } from '../lib/groups';
import { textColor } from '../lib/queue';
import useAction from '../hooks/useAction';
import Modal from './Modal';

export default function CustomerKiosk({ settings, onError, refresh }) {
  const groups = groupLabels(settings);
  const [ticket, setTicket] = useState(null);
  const request = useRef(null);
  const { busy, run } = useAction(onError);
  function receive(group) {
    run(async () => {
      // Reuse a request ID after network failure so the same person receives one number.
      request.current ||= { group, id: crypto.randomUUID() };
      const result = await rpc('issue_queue', { p_group: request.current.group, p_request_id: request.current.id });
      setTicket(result); request.current = null; await refresh();
    });
  }
  return <section className="kiosk-prototype">
    <h1>กรุณากดรับคิว</h1>
    <div className="kiosk-options">
      {Object.entries(groups).map(([group, label]) => <button key={group} className="kiosk-option" style={{ background: settings[`color${group}`], color: textColor(settings[`color${group}`]) }} disabled={busy || !isConfigured} onClick={() => receive(group)} aria-label={`รับคิว${label}`}>
        {busy ? <LoaderCircle size={46} className="animate-spin" /> : <span className="kiosk-option-label">{label}</span>}
      </button>)}
    </div>
    {ticket && <Modal title="รับคิวเรียบร้อยแล้ว" onClose={() => setTicket(null)}><div className="ticket"><Check className="mx-auto text-emerald-500 mb-3" /><p>{groups[ticket.service_group]}</p><div className={`ticket-number${namedQueue(ticket, groups).queue_number.length > 8 ? ' long-number' : ''}`}>{namedQueue(ticket, groups).queue_number}</div><p>กรุณาจดหมายเลขคิวและรอเรียกบนหน้าจอ</p><div className="ticket-footer">วันที่ {ticket.queue_date} · {new Date(ticket.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} น.</div></div><button className="primary-button w-full mt-5" onClick={() => setTicket(null)}>ตกลง</button></Modal>}
  </section>;
}

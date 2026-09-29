import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => { previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-4 mb-5"><h2 className="text-xl font-semibold">{title}</h2><button type="button" aria-label="ปิดหน้าต่าง" className="icon-button" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>, document.body);
}

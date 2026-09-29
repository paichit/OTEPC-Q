import { useRef, useState } from 'react';
export default function useAction(onError) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { return await fn(); }
    catch (error) { onError(error.message || 'ไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง'); }
    finally { locked.current = false; setBusy(false); }
  }
  return { busy, run };
}

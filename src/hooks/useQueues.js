import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc, supabase } from '../supabaseClient';
import { createRefreshQueue } from '../services/refreshQueue';

export default function useQueues(onCall) {
  const [snapshot, setSnapshot] = useState({ queues: [], queue_date: null });
  const [connection, setConnection] = useState(supabase ? 'connecting' : 'unconfigured');
  const [error, setError] = useState('');
  const callRef = useRef(onCall);
  callRef.current = onCall;
  const reader = useRef(null);
  const refresh = useCallback(() => reader.current?.request() ?? Promise.resolve(), []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const queue = createRefreshQueue(
      () => rpc('queue_snapshot'),
      data => { setSnapshot(data); setError(''); },
      failure => setError(failure.message || 'ไม่สามารถโหลดข้อมูลคิวได้'),
    );
    reader.current = queue;
    const channel = supabase.channel('public-queues')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, payload => {
        if (!alive) return;
        // Deliver every call event to TTS even when snapshot reads are combined.
        if (payload.new?.status === 'calling' && (
          payload.old?.status !== 'calling' || payload.old?.called_at !== payload.new.called_at
        )) callRef.current(payload.new);
        refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_group_config' }, () => { if (alive) refresh(); })
      .subscribe(status => {
        if (!alive) return;
        setConnection(status === 'SUBSCRIBED' ? 'live' :
          ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) ? 'offline' : 'connecting');
        // Read again after subscribing to cover events missed during connection setup.
        if (status === 'SUBSCRIBED') refresh();
      });
    refresh();
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', resume);

    // One read at the Bangkok day boundary; no periodic polling.
    let midnight;
    const scheduleMidnight = () => {
      const shifted = Date.now() + 7 * 60 * 60 * 1000;
      midnight = setTimeout(() => { refresh(); scheduleMidnight(); }, 86400000 - shifted % 86400000 + 100);
    };
    scheduleMidnight();
    return () => {
      alive = false;
      queue.dispose();
      if (reader.current === queue) reader.current = null;
      clearTimeout(midnight);
      supabase.removeChannel(channel);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  return { ...snapshot, connection, error, refresh };
}

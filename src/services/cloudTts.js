export const cloudTtsPreference = 'google-cloud-standard-a';

export async function fetchCloudStartupAudio(signal) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
  const response = await fetch(`${url}/functions/v1/queue-tts`, {
    method: 'POST', signal,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'startup' }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Cloud TTS ${response.status}`);
  }
  return response.blob();
}

export async function fetchCloudQueueAudio(queue, template, signal) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
  const response = await fetch(`${url}/functions/v1/queue-tts`, {
    method: 'POST',
    signal,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue_id: queue.id, called_at: queue.called_at, template }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Cloud TTS ${response.status}`);
  }
  return response.blob();
}

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: { action?: string; owner?: string };
  try { body = await request.json(); } catch { return json(400, { error: 'ข้อมูลคำขอไม่ถูกต้อง' }); }
  if (!['claim', 'renew', 'release'].includes(body.action || '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.owner || '')) {
    return json(400, { error: 'คำสั่งหรือตัวระบุจอไม่ถูกต้อง' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(503, { error: 'Supabase ไม่พร้อมใช้งาน' });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const rpcName = body.action === 'claim' ? 'claim_queue_audio_lease'
    : body.action === 'renew' ? 'renew_queue_audio_lease' : 'release_queue_audio_lease';
  const args = body.action === 'release' ? { p_owner: body.owner } : { p_owner: body.owner, p_ttl_seconds: 30 };
  const { data, error } = await db.rpc(rpcName, args);
  if (error) {
    console.error('queue-audio-lock failed:', error.message);
    return json(503, { error: 'ตรวจสอบสิทธิ์เสียงประกาศไม่สำเร็จ' });
  }
  return json(200, { acquired: data === true });
});

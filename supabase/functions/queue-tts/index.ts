import { createClient } from 'npm:@supabase/supabase-js@2';

const bucket = 'queue-tts';
const voiceName = 'th-TH-Standard-A';
const cacheVersion = 'v3-template';
const defaultTemplate = 'ขอเชิญหมายเลขคิว {q} ที่ห้องประชุมค่ะ';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Credentials = { project_id: string; client_email: string; private_key: string };
type Queue = { queue_number: string; queue_date: string; status: string; called_at: string | null };
let cachedToken: { value: string; expiresAt: number } | null = null;

function json(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function base64url(data: Uint8Array) {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function googleAccessToken(credentials: Credentials) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${payload}`;
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}`);
  const result = await response.json();
  if (!result.access_token) throw new Error('Google OAuth returned no access token');
  cachedToken = { value: result.access_token, expiresAt: Date.now() + Math.min(result.expires_in || 3600, 3600) * 1000 };
  return cachedToken.value;
}

async function synthesizeText(text: string, credentials: Credentials) {
  const token = await googleAccessToken(credentials);
  const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': credentials.project_id,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'th-TH', name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9 },
    }),
  });
  if (!response.ok) throw new Error(`Google Text-to-Speech ${response.status}`);
  const result = await response.json();
  if (!result.audioContent) throw new Error('Google Text-to-Speech returned no audio');
  return Uint8Array.from(atob(result.audioContent), char => char.charCodeAt(0));
}

async function synthesize(queueNumber: string, template: string, credentials: Credentials) {
  const spokenDigits: Record<string, string> = { '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง', '3': 'สาม', '4': 'สี่', '5': 'ห้า', '6': 'หก', '7': 'เจ็ด', '8': 'แปด', '9': 'เก้า' };
  const [, prefix, number] = queueNumber.match(/^(กลุ่มทั่วไป|กลุ่มประสบการณ์|A|B)(\d{3,})$/) || [];
  if (!number) throw new Error('invalid queue number');
  const digits = number.split('').map(digit => spokenDigits[digit]).join(' ');
  const group = prefix === 'A' ? 'กลุ่มทั่วไป' : prefix === 'B' ? 'กลุ่มประสบการณ์' : prefix;
  const text = template.replace('{q}', `${group} ${digits}`);
  return synthesizeText(text, credentials);
}

function audioResponse(audio: Uint8Array) {
  return new Response(audio, {
    headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json(405, 'Method not allowed');

  const secret = Deno.env.get('GOOGLE_TTS_SERVICE_ACCOUNT_JSON');
  if (!secret) return json(503, 'Google Cloud TTS ยังไม่ได้ตั้งค่า Secret');
  let credentials: Credentials;
  try {
    credentials = JSON.parse(secret);
    if (!credentials.client_email || !credentials.private_key || credentials.project_id !== 'otepc-q') throw new Error('invalid credentials');
  } catch {
    return json(503, 'Google Cloud TTS Secret ไม่ถูกต้องหรือ Project ID ไม่ตรง');
  }

  let body: { queue_id?: string; called_at?: string; template?: string; action?: string };
  try { body = await request.json(); } catch { return json(400, 'ข้อมูลคำขอไม่ถูกต้อง'); }
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(503, 'Supabase ไม่พร้อมใช้งาน');
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (body.action === 'startup') {
    const startupPath = 'v1-startup/th-TH-Standard-A.mp3';
    const cached = await db.storage.from(bucket).download(startupPath);
    if (cached.data) return audioResponse(new Uint8Array(await cached.data.arrayBuffer()));
    try {
      const audio = await synthesizeText('ระบบเสียงประกาศพร้อมใช้งานค่ะ', credentials);
      if (audio.byteLength > 262144) return json(502, 'ไฟล์เสียงมีขนาดเกินกำหนด');
      const uploaded = await db.storage.from(bucket).upload(startupPath, audio, { contentType: 'audio/mpeg', upsert: false });
      if (uploaded.error) {
        const winner = await db.storage.from(bucket).download(startupPath);
        if (winner.data) return audioResponse(new Uint8Array(await winner.data.arrayBuffer()));
        throw uploaded.error;
      }
      return audioResponse(audio);
    } catch (error) {
      console.error('queue-tts startup failed:', error instanceof Error ? error.message : 'unknown error');
      return json(502, 'สร้างเสียงเริ่มระบบไม่สำเร็จ');
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(body.queue_id || '') || !body.called_at || !Number.isFinite(Date.parse(body.called_at))) {
    return json(400, 'รหัสคิวหรือเวลาเรียกไม่ถูกต้อง');
  }
  const template = body.template === undefined ? defaultTemplate : typeof body.template === 'string' ? body.template.trim() : '';
  if (!template || template.length > 200 || template.split('{q}').length !== 2) {
    return json(400, 'รูปแบบเสียงประกาศต้องมี {q} หนึ่งตำแหน่งและไม่เกิน 200 ตัวอักษร');
  }

  const { data: queue, error: queueError } = await db.from('queues')
    .select('queue_number,queue_date,status,called_at').eq('id', body.queue_id).maybeSingle<Queue>();
  if (queueError) return json(503, 'ตรวจสอบคิวไม่สำเร็จ');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!queue || queue.status !== 'calling' || queue.queue_date !== today ||
      Date.parse(queue.called_at || '') !== Date.parse(body.called_at) ||
      !/^(กลุ่มทั่วไป|กลุ่มประสบการณ์|A|B)\d{3,}$/.test(queue.queue_number)) return json(404, 'ไม่พบคิวที่กำลังเรียก');

  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(template)));
  const templateHash = Array.from(hashBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const callKey = encodeURIComponent(queue.called_at || '');
  const path = `${cacheVersion}/${voiceName}/${templateHash}/${queue.queue_date}/${body.queue_id}-${callKey}.mp3`;
  const cached = await db.storage.from(bucket).download(path);
  if (cached.data) return audioResponse(new Uint8Array(await cached.data.arrayBuffer()));
  try {
    const audio = await synthesize(queue.queue_number, template, credentials);
    if (audio.byteLength > 262144) return json(502, 'ไฟล์เสียงมีขนาดเกินกำหนด');
    const uploaded = await db.storage.from(bucket).upload(path, audio, { contentType: 'audio/mpeg', upsert: false });
    if (uploaded.error) {
      // A simultaneous request may have won the first upload. Use its cached file.
      const winner = await db.storage.from(bucket).download(path);
      if (!winner.data) throw new Error('audio cache upload failed');
      return audioResponse(new Uint8Array(await winner.data.arrayBuffer()));
    }
    return audioResponse(audio);
  } catch (error) {
    console.error('queue-tts failed:', error instanceof Error ? error.message : 'unknown error');
    return json(502, 'สร้างเสียง Google Cloud ไม่สำเร็จ');
  }
});

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isConfigured = Boolean(url?.startsWith('https://') && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_SUPABASE'));
export const supabase = isConfigured ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null;
const staffTokenKey = 'otepc-staff-token';

function staffToken() {
  return sessionStorage.getItem(staffTokenKey);
}

export async function signInStaff(username, password) {
  if (!supabase) throw new Error('กรุณาตั้งค่า Supabase ในไฟล์ .env.local ก่อนใช้งาน');
  const name = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(name)) {
    throw new Error('ชื่อผู้ใช้ต้องเป็นอักษรอังกฤษตัวเล็กขึ้นต้น และยาว 3–32 ตัว ใช้ตัวเลข จุด ขีด หรือขีดล่างได้');
  }
  const data = await rpc('staff_login', { p_username: name, p_password: password });
  if (data?.error) throw new Error(data.error);
  if (!data?.token || !data?.username) throw new Error('ไม่สามารถเริ่มเซสชันเจ้าหน้าที่ได้ กรุณาลองอีกครั้ง');
  sessionStorage.setItem(staffTokenKey, data.token);
  return { username: data.username, expires_at: data.expires_at };
}

export async function getStaffSession() {
  const token = staffToken();
  if (!token) return null;
  const data = await rpc('staff_session', { p_token: token });
  if (!data) sessionStorage.removeItem(staffTokenKey);
  return data;
}

export async function signOutStaff() {
  const token = staffToken();
  sessionStorage.removeItem(staffTokenKey);
  if (token) await rpc('staff_logout', { p_token: token });
}

export async function staffRpc(name, args = {}) {
  const token = staffToken();
  if (!token) throw new Error('กรุณาเข้าสู่ระบบเจ้าหน้าที่อีกครั้ง');
  try {
    return await rpc(name, { p_token: token, ...args });
  } catch (error) {
    if (/เซสชันเจ้าหน้าที่หมดอายุ/.test(error.message)) {
      sessionStorage.removeItem(staffTokenKey);
      window.dispatchEvent(new Event('otepc-staff-expired'));
    }
    throw error;
  }
}

export async function rpc(name, args = {}) {
  if (!supabase) throw new Error('กรุณาตั้งค่า Supabase ในไฟล์ .env.local ก่อนใช้งาน');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

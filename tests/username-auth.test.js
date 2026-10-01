import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const password = 'safe-test-password-123';
const sql = file => readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8');

test('username-only staff authentication and queue permissions', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema public to anon, authenticated;');
    await db.exec((await sql('schema.sql')).split('-- REALTIME SETUP')[0]);
    const query = async (statement, params = []) => (await db.query(statement, params)).rows[0];
    const login = async (name, pass) => (await query('select public.staff_login($1, $2) as result', [name, pass])).result;
    const issue = async (group, id) => (await query('select to_jsonb(public.issue_queue($1, $2)) as q', [group, id])).q;
    const snapshot = async () => (await query('select public.queue_snapshot() as s')).s;

    await t.test('private tables and no Auth user/email dependency', async () => {
      assert.equal((await query("select to_regclass('auth.users') as table_name")).table_name, null);
      await db.exec('set role anon');
      await assert.rejects(db.exec('select * from public.staff_accounts'));
      await assert.rejects(db.exec('select * from public.staff_sessions'));
      await db.exec('reset role');
    });

    await db.exec(`insert into public.staff_accounts (username, password_hash)
      values ('staff01', extensions.crypt('${password}', extensions.gen_salt('bf', 12)))`);
    await db.exec('set role anon');
    await t.test('password checks, lockout, session verification and logout', async () => {
      assert.match((await login('staff01', 'wrong-password-123')).error, /ไม่ถูกต้อง/);
      await db.exec('reset role');
      assert.equal((await query("select failed_attempts from public.staff_accounts where username='staff01'")).failed_attempts, 1);
      await db.exec('set role anon');
      const signed = await login('staff01', password);
      assert.match(signed.token, /^[0-9a-f]{64}$/);
      assert.equal((await query('select public.staff_session($1) as result', [signed.token])).result.username, 'staff01');
      assert.equal((await query('select public.staff_session($1) as result', ['a'.repeat(64)])).result, null);
      await db.exec('reset role');
      assert.equal((await query("select count(*)::int as n from public.staff_sessions where token_hash=$1", [signed.token])).n, 0);
      await db.exec('set role anon');
      await query('select public.staff_logout($1)', [signed.token]);
      assert.equal((await query('select public.staff_session($1) as result', [signed.token])).result, null);
      for (let i = 0; i < 5; i++) await login('staff01', 'wrong-password-123');
      assert.match((await login('staff01', password)).error, /ล็อกชั่วคราว/);
      await db.exec('reset role');
      await db.exec("update public.staff_accounts set locked_until = now() - interval '1 minute' where username='staff01'");
      await db.exec('set role anon');
    });

    const token = (await login('staff01', password)).token;
    await t.test('staff token gates queue actions and retains FIFO/recall/history/reset', async () => {
      const a = await issue('A', '11111111-1111-4111-8111-111111111111');
      const b = await issue('B', '22222222-2222-4222-8222-222222222222');
      assert.equal(a.queue_number, 'กลุ่มทั่วไป001');
      assert.equal(b.queue_number, 'กลุ่มประสบการณ์001');
      await assert.rejects(db.exec('select public.call_next(null)'));
      await assert.rejects(db.query('select public.call_next($1, null)', ['a'.repeat(64)]), /เซสชันเจ้าหน้าที่/);
      await assert.rejects(db.query("select public.call_next_in_group($1, 'A', null)", ['a'.repeat(64)]), /เซสชันเจ้าหน้าที่/);
      const first = (await query("select to_jsonb(public.call_next_in_group($1, 'A', null)) as q", [token])).q;
      assert.equal(first.id, a.id);
      await query('select public.recall_current($1, $2)', [token, a.id]);
      const history = (await query('select public.queue_call_history($1, 50) as h', [token])).h;
      assert.equal(history.find(row => row.queue_id === a.id).call_count, 2);
      const second = (await query("select to_jsonb(public.call_next_in_group($1, 'B', null)) as q", [token])).q;
      assert.equal(second.id, b.id);
      assert.equal((await snapshot()).queues.find(q => q.id === a.id).status, 'calling');
      await query('select public.reset_today($1)', [token]);
      assert.equal((await snapshot()).queues.length, 0);
      assert.equal((await query('select public.queue_call_history($1, 50) as h', [token])).h.length, 2);
    });
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('migration replaces the empty Auth-linked staff table without touching queues', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto with schema extensions; create schema auth; create table auth.users(id uuid primary key);');
    const schema = await sql('schema.sql');
    await db.exec(schema.slice(0, schema.indexOf('-- Staff accounts have no email')));
    await db.exec(await sql('migrate-staff-usernames.sql'));
    await db.exec("insert into public.queues(queue_number,service_group,request_id) values ('A001','A',gen_random_uuid())");
    await db.exec(await sql('migrate-username-only-auth.sql'));
    assert.equal((await db.query('select count(*)::int as n from public.queues')).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='staff_accounts' and column_name='user_id'")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='staff_accounts' and column_name='password_hash'")).rows[0].n, 1);
  } finally { await db.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('upgrading single calling point preserves tickets, history, staff and audio lease', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema public to anon, authenticated;');
    // Git checkouts on Windows may use CRLF; fixture rewrites operate on LF lines.
    let schema = (await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n').split('-- REALTIME SETUP')[0];
    const legacy = (await readFile(new URL('../supabase/migrate-username-only-auth.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const legacyCall = legacy.match(/create function public\.call_next\([\s\S]*?\n\$\$;/)[0];
    schema = schema.replace(/create function public\.call_next\([\s\S]*?\n\$\$;/, () => legacyCall)
      .replace(/create function public\.call_next_in_group\([\s\S]*?\n\$\$;/, '')
      .replace(/^.*function public\.call_next_in_group\(.*\n/gm, '')
      .replace("create unique index queues_one_active_call_per_group on public.queues (queue_date, service_group) where status = 'calling';", "create unique index queues_one_active_call_per_day on public.queues (queue_date) where status = 'calling';")
      .replace(/^create index queues_group_waiting.*\n/gm, '')
      .replace("    'calling_mode', 'by_group',\n", '');
    await db.exec(schema);
    await db.exec("insert into public.staff_accounts (username, password_hash) values ('staff01', extensions.crypt('safe-test-password-123', extensions.gen_salt('bf', 12)))");
    const token = (await db.query("select public.staff_login('staff01', 'safe-test-password-123') as login")).rows[0].login.token;
    const issue = async group => (await db.query('select to_jsonb(public.issue_queue($1, $2)) as q', [group, randomUUID()])).rows[0].q;
    const a = await issue('A');
    const b = await issue('B');
    await db.query('select public.call_next($1, null)', [token]);
    const owner = randomUUID();
    await db.query('select public.claim_queue_audio_lease($1)', [owner]);
    const snapshot = async () => (await db.query('select public.queue_snapshot() as s')).rows[0].s;
    const before = await snapshot();
    const lease = (await db.query('select * from public.queue_audio_lease')).rows;
    const migration = await readFile(new URL('../supabase/migrate-group-calling.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const after = await snapshot();
    assert.equal(after.calling_mode, 'by_group');
    assert.deepEqual(after.queues, before.queues);
    assert.deepEqual((await db.query('select * from public.queue_audio_lease')).rows, lease);
    await db.exec('set role anon');
    assert.equal((await db.query('select public.staff_session($1) as s', [token])).rows[0].s.username, 'staff01');
    await assert.rejects(db.query("select public.call_next_in_group(null, 'B', null)"), /เซสชันเจ้าหน้าที่/);
    await assert.rejects(db.query('select public.call_next($1, $2)', [token, a.id]), /รีเฟรชหน้าเว็บ/);
    const calledB = (await db.query("select to_jsonb(public.call_next_in_group($1, 'B', null)) as q", [token])).rows[0].q;
    assert.equal(calledB.id, b.id);
    assert.equal((await snapshot()).queues.find(q => q.id === a.id).status, 'calling');
    await assert.rejects(db.query("select public.call_next_in_group($1, 'B', $2)", [token, a.id]), /เปลี่ยนโดยเจ้าหน้าที่/);
    await db.exec('reset role');
    await assert.rejects(db.exec("insert into public.queues(queue_number, service_group, request_id, status, called_at) values ('A002', 'A', gen_random_uuid(), 'calling', now())"), /queues_one_active_call_per_group/);
    const b2 = await issue('B');
    const a2 = await issue('A');
    await db.query('select public.cancel_waiting($1, $2)', [token, a2.id]);
    const a3 = await issue('A');
    // A far-future waiting ticket from B must not determine the restored A line.
    await db.query("update public.queues set created_at = now() + interval '1 day' where id = $1", [b2.id]);
    const restored = (await db.query('select to_jsonb(public.restore_cancelled($1, $2)) as q', [token, a2.id])).rows[0].q;
    assert.ok(restored.created_at > a3.created_at);
    assert.ok(new Date(restored.created_at) < new Date(Date.now() + 60_000));
    assert.equal(restored.queue_number, a2.queue_number);
  } finally { await db.close(); }
});

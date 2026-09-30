import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('PostgreSQL queue lifecycle, idempotency, date scoping and permissions', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema public to anon, authenticated;');
    const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema.split('-- REALTIME SETUP')[0]);
    await db.exec("insert into public.staff_accounts (username, password_hash) values ('staff01', extensions.crypt('safe-test-password-123', extensions.gen_salt('bf', 12)))");
    await db.exec('set role anon');
    const token = (await db.query("select public.staff_login('staff01', 'safe-test-password-123') as login")).rows[0].login.token;
    await db.exec('reset role');
    const issue = async (group, id = randomUUID()) => (await db.query('select to_jsonb(public.issue_queue($1, $2)) as q', [group, id])).rows[0].q;
    const call = async (expected = null) => (await db.query('select to_jsonb(public.call_next($1, $2)) as q', [token, expected])).rows[0].q;
    const snapshot = async () => (await db.query('select public.queue_snapshot() as s')).rows[0].s;
    let a1, a2, b1;
    await t.test('anonymous kiosk can issue, retry returns the identical ticket', async () => {
      await db.exec('set role anon');
      const id = randomUUID(); a1 = await issue('A', id); b1 = await issue('B'); a2 = await issue('A');
      assert.equal(a1.queue_number, 'กลุ่มทั่วไป001'); assert.equal(a2.queue_number, 'กลุ่มทั่วไป002'); assert.equal(b1.queue_number, 'กลุ่มประสบการณ์001');
      assert.equal((await issue('A', id)).id, a1.id);
      assert.equal((await snapshot()).queues.length, 3);
      await assert.rejects(issue('C'));
      await assert.rejects(db.exec('delete from public.queues'));
      await assert.rejects(db.exec('select public.call_next(null)'));
      await assert.rejects(db.exec('select public.reset_today()'));
      await assert.rejects(db.query('select public.recall_current($1)', [a1.id]));
      await assert.rejects(db.query('select public.cancel_waiting($1)', [a1.id]));
      await assert.rejects(db.exec('select public.queue_call_history()'));
      await assert.rejects(db.exec('select * from public.queue_call_events'));
      await db.exec('reset role');
    });
    await db.exec('set role anon');
    await t.test('FIFO across A/B, atomic completion, and stale call protection', async () => {
      assert.equal((await call()).id, a1.id);
      await assert.rejects(call(), /เปลี่ยนโดยเจ้าหน้าที่/);
      assert.equal((await call(a1.id)).id, b1.id);
      assert.equal((await snapshot()).queues.find(q => q.id === a1.id).status, 'completed');
      assert.equal((await snapshot()).queues.find(q => q.id === b1.id).status, 'calling');
      assert.equal((await call(b1.id)).id, a2.id);
      const empty = await call(a2.id);
      assert.ok(empty === null || empty.id === null);
      assert.equal((await snapshot()).queues.find(q => q.id === a2.id).status, 'calling');
      assert.equal((await snapshot()).queues.filter(q => q.status === 'calling').length, 1);
      assert.equal((await snapshot()).queues.find(q => q.id === a1.id).call_count, 1);
    });
    await t.test('recall creates a separate event and cancel affects waiting only', async () => {
      await db.query('select public.recall_current($1, $2)', [token, a2.id]);
      await db.query('select public.recall_current($1, $2)', [token, a2.id]);
      assert.equal((await snapshot()).queues.find(q => q.id === a2.id).call_count, 3);
      const history = (await db.query('select public.queue_call_history($1, 50) as h', [token])).rows[0].h;
      const entry = history.find(q => q.queue_id === a2.id);
      assert.equal(entry.call_count, 3);
      assert.deepEqual(entry.events.map(e => e.event_kind), ['initial', 'recall', 'recall']);
      const currentHistory = (await db.query('select public.queue_call_history_current($1) as h', [token])).rows[0].h;
      assert.equal(currentHistory.length, 3);
      assert.ok(currentHistory.some(q => q.queue_id === a2.id));
      await assert.rejects(db.query('select public.cancel_waiting($1, $2)', [token, a2.id]), /ไม่ได้อยู่ในรายการรอ/);
      await db.exec('reset role');
      const waiting = await issue('B');
      await db.exec('set role anon');
      await db.query('select public.cancel_waiting($1, $2)', [token, waiting.id]);
      assert.equal((await snapshot()).queues.find(q => q.id === waiting.id).status, 'cancelled');
      const currentWithCancellation = (await db.query('select public.queue_call_history_current($1) as h', [token])).rows[0].h;
      assert.equal(currentWithCancellation.length, 4);
      const cancellation = currentWithCancellation.find(q => q.queue_id === waiting.id);
      assert.equal(cancellation.status, 'cancelled');
      assert.equal(cancellation.call_count, 0);
      assert.deepEqual(cancellation.events, []);
      assert.ok(cancellation.cancelled_at);
      const allHistoryWithCancellation = (await db.query('select public.queue_call_history($1) as h', [token])).rows[0].h;
      assert.equal(allHistoryWithCancellation.find(q => q.queue_id === waiting.id).status, 'cancelled');
      await assert.rejects(db.query('select public.cancel_waiting($1, $2)', [token, waiting.id]), /ไม่ได้อยู่ในรายการรอ/);
    });
    await t.test('Skip RPC is unavailable to staff', async () => {
      await assert.rejects(db.query('select public.skip_queue($1)', [a2.id]), /does not exist/);
      assert.equal((await snapshot()).queues.find(q => q.id === a2.id).status, 'calling');
    });
    await t.test('snapshot bounds recent history to 50 and includes all waiting queues', async () => {
      await db.exec('reset role');
      await db.exec(`insert into public.queues (queue_number, service_group, request_id, status)
        select 'A' || (100 + i)::text, 'A', gen_random_uuid(), 'completed' from generate_series(1, 55) i`);
      await db.exec('set role anon');
      assert.equal((await snapshot()).queues.filter(q => ['completed', 'skipped', 'cancelled'].includes(q.status)).length, 50);
    });
    await t.test('snapshot has no 1000-row cap for active queues', async () => {
      await db.exec('reset role');
      await db.exec(`insert into public.queues (queue_number, service_group, request_id)
        select 'B' || (1000 + i)::text, 'B', gen_random_uuid() from generate_series(1, 1001) i`);
      await db.exec('set role anon');
      assert.equal((await snapshot()).queues.filter(q => q.status === 'waiting').length, 1001);
      await db.exec('reset role');
      await db.exec('set role anon');
    });
    await t.test('history migration increases snapshot from 20 to 50 and can be reapplied', async () => {
      const previous = await readFile(new URL('../supabase/migrate-recall-cancel.sql', import.meta.url), 'utf8');
      const start = previous.indexOf('create or replace function public.queue_snapshot()');
      const end = previous.indexOf('\n$$;', start) + 4;
      await db.exec('reset role');
      await db.exec('drop index public.queues_daily_history');
      await db.exec(previous.slice(start, end));
      await db.exec('set role anon');
      const before = await snapshot();
      assert.equal(before.queues.filter(q => ['completed', 'skipped', 'cancelled'].includes(q.status)).length, 20);
      await db.exec('reset role');
      const migration = await readFile(new URL('../supabase/migrate-snapshot-performance.sql', import.meta.url), 'utf8');
      await db.exec(migration);
      await db.exec(migration);
      const historyMigration = await readFile(new URL('../supabase/migrate-recent-history-50.sql', import.meta.url), 'utf8');
      await db.exec(historyMigration);
      await db.exec(historyMigration);
      const scopeMigration = await readFile(new URL('../supabase/migrate-current-and-full-call-history.sql', import.meta.url), 'utf8');
      await db.exec(scopeMigration);
      await db.exec(scopeMigration);
      const cancellationMigration = await readFile(new URL('../supabase/migrate-current-history-cancellations.sql', import.meta.url), 'utf8');
      await db.exec(cancellationMigration);
      await db.exec(cancellationMigration);
      const allHistoryCancellationMigration = await readFile(new URL('../supabase/migrate-all-history-cancellations.sql', import.meta.url), 'utf8');
      await db.exec(allHistoryCancellationMigration);
      await db.exec(allHistoryCancellationMigration);
      await db.exec('set role anon');
      const after = await snapshot();
      assert.equal(after.queues.filter(q => ['completed', 'skipped', 'cancelled'].includes(q.status)).length, 50);
      assert.deepEqual(after.queues.filter(q => q.status === 'waiting'), before.queues.filter(q => q.status === 'waiting'));
      await assert.rejects(db.exec('select public.queue_call_history()'));
      await assert.rejects(db.exec('select public.queue_call_history_current(null)'));
      await assert.rejects(db.exec('select * from public.queue_call_events'));
      await assert.rejects(db.exec('select public.call_next(null)'));
      await db.exec('reset role');
      await db.exec('set role anon');
    });
    await t.test('reset affects today only and restarts numbering', async () => {
      await db.exec('reset role');
      await db.exec(`insert into public.queues (queue_date, queue_number, service_group, request_id)
        values ((now() at time zone 'Asia/Bangkok')::date - 1, 'A001', 'A', gen_random_uuid())`);
      await db.exec('set role anon');
      await db.query('select public.reset_today($1)', [token]);
      assert.equal((await snapshot()).queues.length, 0);
      assert.equal((await db.query('select public.queue_call_history_current($1) as h', [token])).rows[0].h.length, 0);
      await db.exec('reset role');
      await db.exec(`insert into public.queue_call_events (queue_id, queue_date, queue_number, event_kind, called_at)
        select gen_random_uuid(), (now() at time zone 'Asia/Bangkok')::date, 'A' || (10000 + i)::text,
          'initial', now() - i * interval '1 second' from generate_series(1, 105) i`);
      await db.exec('set role anon');
      assert.equal((await issue('A')).queue_number, 'กลุ่มทั่วไป001');
      const newCurrent = await call();
      assert.equal(newCurrent.queue_number, 'กลุ่มทั่วไป001');
      const currentHistory = (await db.query('select public.queue_call_history_current($1) as h', [token])).rows[0].h;
      const allHistory = (await db.query('select public.queue_call_history($1) as h', [token])).rows[0].h;
      assert.deepEqual(currentHistory.map(q => q.queue_id), [newCurrent.id]);
      assert.ok(allHistory.some(q => q.queue_id === b1.id));
      assert.ok(allHistory.some(q => q.status === 'cancelled'));
      assert.equal(allHistory.length, 110);
      await db.exec('reset role');
      assert.equal((await db.query('select count(*)::int as n from public.queues')).rows[0].n, 2);
    });
  } finally { await db.close(); }
});

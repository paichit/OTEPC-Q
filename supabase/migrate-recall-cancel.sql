-- Run once on an existing single-calling-point project.
-- This migration retains call events after reset; older unrecorded recalls cannot be recovered.
begin;
alter table public.queues drop constraint if exists queues_status_check;
alter table public.queues add constraint queues_status_check check (status in ('waiting', 'calling', 'completed', 'skipped', 'cancelled'));
alter table public.queues add column if not exists cancelled_at timestamptz;
create table public.queue_call_events (
  id bigint generated always as identity primary key,
  queue_id uuid not null,
  queue_date date not null,
  queue_number text not null,
  event_kind text not null check (event_kind in ('initial', 'recall')),
  called_at timestamptz not null,
  staff_id uuid
);
create index queue_call_events_queue on public.queue_call_events (queue_id, called_at, id);
create index queue_call_events_recent on public.queue_call_events (called_at desc, id desc);
alter table public.queue_call_events enable row level security;
revoke all on public.queue_call_events from anon, authenticated;
-- No direct table policies: staff-only RPC exposes audit data.


insert into public.queue_call_events (queue_id, queue_date, queue_number, event_kind, called_at)
select id, queue_date, queue_number, 'initial', called_at from public.queues where called_at is not null;

create or replace function public.call_next(p_expected uuid default null) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  next_queue public.queues;
  current_id uuid;
begin
  perform public.require_queue_staff();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  select id into current_id from public.queues where queue_date = d and status = 'calling';
  if current_id is distinct from p_expected then
    raise exception 'คิวปัจจุบันถูกเปลี่ยนโดยเจ้าหน้าที่อีกคนแล้ว กรุณาโหลดข้อมูลอีกครั้ง';
  end if;
  select * into next_queue from public.queues
    where queue_date = d and status = 'waiting'
    order by created_at, id limit 1 for update;
  if not found then return null; end if;
  update public.queues set status = 'completed', updated_at = clock_timestamp() where id = current_id;
  update public.queues set status = 'calling', counter_number = null, called_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = next_queue.id returning * into next_queue;
  insert into public.queue_call_events (queue_id, queue_date, queue_number, event_kind, called_at, staff_id)
    values (next_queue.id, next_queue.queue_date, next_queue.queue_number, 'initial', next_queue.called_at, (auth.jwt() ->> 'sub')::uuid);
  return next_queue;
end;
$$;

create or replace function public.recall_current(p_expected uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  result public.queues;
begin
  perform public.require_queue_staff();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  update public.queues set called_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_expected and queue_date = d and status = 'calling' returning * into result;
  if not found then raise exception 'คิวปัจจุบันเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  insert into public.queue_call_events (queue_id, queue_date, queue_number, event_kind, called_at, staff_id)
    values (result.id, result.queue_date, result.queue_number, 'recall', result.called_at, (auth.jwt() ->> 'sub')::uuid);
  return result;
end;
$$;

create or replace function public.cancel_waiting(p_queue_id uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  result public.queues;
begin
  perform public.require_queue_staff();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  update public.queues set status = 'cancelled', cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_queue_id and queue_date = d and status = 'waiting' returning * into result;
  if not found then raise exception 'คิวนี้ไม่ได้อยู่ในรายการรอแล้ว กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  return result;
end;
$$;

create or replace function public.queue_call_history(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff();
  with recent as (
    select queue_id, max(called_at) as last_called_at
    from public.queue_call_events group by queue_id
    order by last_called_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'queue_id', r.queue_id, 'queue_date', e.queue_date, 'queue_number', e.queue_number,
    'call_count', count_data.call_count, 'recall_count', count_data.call_count - 1,
    'last_called_at', r.last_called_at, 'events', count_data.events
  ) order by r.last_called_at desc), '[]'::jsonb) into result
  from recent r
  join lateral (
    select queue_date, queue_number from public.queue_call_events
    where queue_id = r.queue_id order by called_at desc, id desc limit 1
  ) e on true
  join lateral (
    select count(*)::integer as call_count,
      jsonb_agg(jsonb_build_object('event_kind', event_kind, 'called_at', called_at, 'staff_id', staff_id) order by called_at, id) as events
    from public.queue_call_events where queue_id = r.queue_id
  ) count_data on true;
  return result;
end;
$$;

create or replace function public.queue_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  with daily as (
    select * from public.queues where queue_date = (now() at time zone 'Asia/Bangkok')::date
  ), recent as (
    select * from daily where status in ('completed', 'skipped', 'cancelled') order by updated_at desc, id limit 20
  ), visible as (
    select * from daily where status in ('waiting', 'calling')
    union all select * from recent
  )
  select jsonb_build_object(
    'queue_date', (now() at time zone 'Asia/Bangkok')::date,
    'queues', coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object('call_count', (select count(*) from public.queue_call_events e where e.queue_id = v.id)) order by created_at, id) from visible v), '[]'::jsonb)
  );
$$;

revoke all on function public.recall_current(uuid) from public, anon, authenticated;
revoke all on function public.cancel_waiting(uuid) from public, anon, authenticated;
revoke all on function public.queue_call_history(integer) from public, anon, authenticated;
grant execute on function public.recall_current(uuid) to authenticated;
grant execute on function public.cancel_waiting(uuid) to authenticated;
grant execute on function public.queue_call_history(integer) to authenticated;
commit;

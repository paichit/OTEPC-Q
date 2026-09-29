-- Run once in Supabase SQL Editor after the original multi-counter schema.
-- Keeps historical rows. If several counters are currently calling, only the
-- most recently called queue stays active; the others become completed.
begin;
drop function if exists public.call_next(text, integer, uuid);
drop function if exists public.skip_queue(uuid, integer);
drop function if exists public.skip_queue(uuid);
drop index if exists public.queues_one_call_per_counter;
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.queues'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%counter_number%'
      and pg_get_constraintdef(oid) like '%called_at%'
  loop
    execute format('alter table public.queues drop constraint %I', constraint_name);
  end loop;
end $$;
alter table public.queues add constraint queues_call_requires_time
  check (status <> 'calling' or called_at is not null);
with ranked as (
  select id, row_number() over (
    partition by queue_date order by called_at desc nulls last, updated_at desc, id
  ) as position
  from public.queues where status = 'calling'
)
update public.queues q
set status = 'completed', updated_at = clock_timestamp()
from ranked r where q.id = r.id and r.position > 1;
create unique index queues_one_active_call_per_day
  on public.queues (queue_date) where status = 'calling';
drop index if exists public.queues_daily_waiting;
create index queues_daily_waiting
  on public.queues (queue_date, created_at, id) where status = 'waiting';
create function public.call_next(p_expected uuid default null) returns public.queues
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
  return next_queue;
end;
$$;
create or replace function public.queue_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with daily as (
    select * from public.queues where queue_date = (now() at time zone 'Asia/Bangkok')::date
  ), recent as (
    select * from daily where status in ('completed', 'skipped') order by updated_at desc, id limit 20
  ), visible as (
    select * from daily where status in ('waiting', 'calling')
    union all select * from recent
  )
  select jsonb_build_object(
    'queue_date', (now() at time zone 'Asia/Bangkok')::date,
    'queues', coalesce((select jsonb_agg(to_jsonb(v) order by created_at, id) from visible v), '[]'::jsonb)
  );
$$;
revoke all on function public.call_next(uuid) from public, anon, authenticated;
grant execute on function public.call_next(uuid) to authenticated;
commit;

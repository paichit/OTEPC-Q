-- Keep canceled queue snapshots after reset and include them in all-time history.
-- Apply in the Supabase SQL Editor after the queue call history migrations.
begin;

create table if not exists public.queue_cancel_events (
  queue_id uuid primary key,
  queue_date date not null,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  cancelled_at timestamptz not null
);
create index if not exists queue_cancel_events_recent
  on public.queue_cancel_events (cancelled_at desc, queue_id);
alter table public.queue_cancel_events enable row level security;
revoke all on public.queue_cancel_events from public, anon, authenticated;

-- Preserve canceled rows that still exist (for example, before today's reset).
insert into public.queue_cancel_events (queue_id, queue_date, queue_number, service_group, cancelled_at)
select id, queue_date, queue_number, service_group, coalesce(cancelled_at, updated_at)
from public.queues
where status = 'cancelled'
on conflict (queue_id) do nothing;

create or replace function public.cancel_waiting(p_token text, p_queue_id uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  result public.queues;
  cancelled_time timestamptz := clock_timestamp();
begin
  perform public.require_queue_staff(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  update public.queues set status = 'cancelled', cancelled_at = cancelled_time, updated_at = cancelled_time
    where id = p_queue_id and queue_date = d and status = 'waiting' returning * into result;
  if not found then raise exception 'คิวนี้ไม่ได้อยู่ในรายการรอแล้ว กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  insert into public.queue_cancel_events (queue_id, queue_date, queue_number, service_group, cancelled_at)
    values (result.id, result.queue_date, result.queue_number, result.service_group, result.cancelled_at)
    on conflict (queue_id) do nothing;
  return result;
end;
$$;

create or replace function public.queue_call_history(p_token text, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff(p_token);
  -- Keep p_limit in the signature for backwards compatibility; this view returns all history.
  with recent as (
    select queue_id, max(called_at) as last_called_at
    from public.queue_call_events group by queue_id
  ), called as (
    select r.last_called_at as activity_at, jsonb_build_object(
      'queue_id', r.queue_id, 'queue_date', e.queue_date, 'queue_number', e.queue_number,
      'status', 'called', 'call_count', count_data.call_count,
      'recall_count', count_data.call_count - 1, 'last_called_at', r.last_called_at,
      'events', count_data.events
    ) as item
    from recent r
    join lateral (
      select queue_date, queue_number from public.queue_call_events
      where queue_id = r.queue_id order by called_at desc, id desc limit 1
    ) e on true
    join lateral (
      select count(*)::integer as call_count,
        jsonb_agg(jsonb_build_object('event_kind', event_kind, 'called_at', called_at, 'staff_id', staff_id) order by called_at, id) as events
      from public.queue_call_events where queue_id = r.queue_id
    ) count_data on true
  ), cancelled as (
    select c.cancelled_at as activity_at, jsonb_build_object(
      'queue_id', c.queue_id, 'queue_date', c.queue_date, 'queue_number', c.queue_number,
      'status', 'cancelled', 'call_count', 0, 'recall_count', 0,
      'cancelled_at', c.cancelled_at, 'events', '[]'::jsonb
    ) as item
    from public.queue_cancel_events c
  )
  select coalesce(jsonb_agg(item order by activity_at desc), '[]'::jsonb) into result
  from (select * from called union all select * from cancelled) entries;
  return result;
end;
$$;

revoke all on function public.cancel_waiting(text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_waiting(text, uuid) to anon;
revoke all on function public.queue_call_history(text, integer) from public, anon, authenticated;
grant execute on function public.queue_call_history(text, integer) to anon;
notify pgrst, 'reload schema';

commit;

-- Apply after migrate-uat-groups-and-restore.sql.
-- Preserve every cancellation when a restored queue is cancelled again.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'queue_cancel_events' and column_name = 'id'
  ) then
    alter table public.queue_cancel_events drop constraint queue_cancel_events_pkey;
    alter table public.queue_cancel_events add column id bigint generated always as identity;
    alter table public.queue_cancel_events add constraint queue_cancel_events_pkey primary key (id);
  end if;
end;
$$;
create index if not exists queue_cancel_events_queue
  on public.queue_cancel_events (queue_id, cancelled_at desc);

-- Keep staff permissions unchanged while refreshing the RPCs.

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
    values (result.id, result.queue_date, result.queue_number, result.service_group, result.cancelled_at);
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
  ), restored as (
    select r.restored_at as activity_at, jsonb_build_object(
      'queue_id', r.queue_id, 'queue_date', r.queue_date, 'queue_number', r.queue_number,
      'status', 'restored', 'call_count', 0, 'restored_at', r.restored_at,
      'events', '[]'::jsonb
    ) as item
    from public.queue_restore_events r
  )
  select coalesce(jsonb_agg(item order by activity_at desc), '[]'::jsonb) into result
  from (select * from called union all select * from cancelled union all select * from restored) entries;
  return result;
end;
$$;

create or replace function public.queue_call_history_current(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff(p_token);
  with current_events as (
    select e.queue_id, max(e.called_at) as last_called_at
    from public.queue_call_events e
    join public.queues q on q.id = e.queue_id
    where q.queue_date = (now() at time zone 'Asia/Bangkok')::date
    group by e.queue_id
  ), called as (
    select r.queue_id, r.last_called_at as activity_at, jsonb_build_object(
      'queue_id', r.queue_id, 'queue_date', e.queue_date, 'queue_number', e.queue_number,
      'status', 'called', 'call_count', count_data.call_count,
      'recall_count', count_data.call_count - 1,
      'last_called_at', r.last_called_at, 'events', count_data.events
    ) as item
    from current_events r
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
    select c.queue_id, c.cancelled_at as activity_at,
      jsonb_build_object(
        'queue_id', c.queue_id, 'queue_date', c.queue_date, 'queue_number', c.queue_number,
        'status', 'cancelled', 'call_count', 0, 'recall_count', 0,
        'cancelled_at', c.cancelled_at, 'events', '[]'::jsonb
      ) as item
    from public.queue_cancel_events c join public.queues q on q.id = c.queue_id
    where q.queue_date = (now() at time zone 'Asia/Bangkok')::date
  ), restored as (
    select r.queue_id, r.restored_at as activity_at,
      jsonb_build_object(
        'queue_id', r.queue_id, 'queue_date', r.queue_date, 'queue_number', r.queue_number,
        'status', 'restored', 'call_count', 0, 'restored_at', r.restored_at,
        'events', '[]'::jsonb
      ) as item
    from public.queue_restore_events r join public.queues q on q.id = r.queue_id
    where q.queue_date = (now() at time zone 'Asia/Bangkok')::date
  )
  select coalesce(jsonb_agg(item order by activity_at desc, queue_id), '[]'::jsonb)
    into result from (
      select * from called
      union all
      select * from cancelled
      union all
      select * from restored
    ) entries;
  return result;
end;
$$;

revoke all on function public.cancel_waiting(text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_waiting(text, uuid) to anon;
revoke all on function public.queue_call_history(text, integer) from public, anon, authenticated;
grant execute on function public.queue_call_history(text, integer) to anon;
revoke all on function public.queue_call_history_current(text) from public, anon, authenticated;
grant execute on function public.queue_call_history_current(text) to anon;
notify pgrst, 'reload schema';
commit;

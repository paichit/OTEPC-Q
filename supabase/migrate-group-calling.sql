-- Existing project only: prefer testing in Dev; verify the target project before running.
-- A shared UAT database requires pausing legacy clients and updating the frontend.
-- This changes calling behavior, preserves queues/history/accounts/audio lease,
-- and requires refreshing every staff/display tab to the new frontend.
begin;

drop index if exists public.queues_one_active_call_per_day;
create unique index if not exists queues_one_active_call_per_group
  on public.queues (queue_date, service_group) where status = 'calling';
create index if not exists queues_group_waiting
  on public.queues (queue_date, service_group, created_at, id) where status = 'waiting';

-- Legacy clients must refresh rather than complete a different group's ticket.
create or replace function public.call_next(p_token text, p_expected uuid default null) returns public.queues
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_queue_staff(p_token);
  raise exception 'ระบบเปลี่ยนเป็นเรียกคิวแยกกลุ่มแล้ว กรุณารีเฟรชหน้าเว็บก่อนเรียกคิว';
end;
$$;

create or replace function public.call_next_in_group(p_token text, p_group text, p_expected uuid default null) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  d date := (now() at time zone 'Asia/Bangkok')::date;
  next_queue public.queues;
  current_id uuid;
begin
  actor_id := public.require_queue_staff(p_token);
  if p_group is null or p_group not in ('A', 'B') then
    raise exception 'กลุ่มไม่ถูกต้อง';
  end if;
  -- Share the existing daily lock with issue/cancel/restore/recall/reset.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  select id into current_id from public.queues
    where queue_date = d and service_group = p_group and status = 'calling';
  if current_id is distinct from p_expected then
    raise exception 'คิวปัจจุบันของกลุ่มนี้ถูกเปลี่ยนโดยเจ้าหน้าที่อีกคนแล้ว กรุณาโหลดข้อมูลอีกครั้ง';
  end if;
  select * into next_queue from public.queues
    where queue_date = d and service_group = p_group and status = 'waiting'
    order by created_at, id limit 1 for update;
  if not found then return null; end if;
  update public.queues set status = 'completed', updated_at = clock_timestamp() where id = current_id;
  update public.queues set status = 'calling', counter_number = null, called_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = next_queue.id returning * into next_queue;
  insert into public.queue_call_events (queue_id, queue_date, queue_number, event_kind, called_at, staff_id)
    values (next_queue.id, next_queue.queue_date, next_queue.queue_number, 'initial', next_queue.called_at, actor_id);
  return next_queue;
end;
$$;

create or replace function public.restore_cancelled(p_token text, p_queue_id uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  d date := (now() at time zone 'Asia/Bangkok')::date;
  restored_time timestamptz;
  result public.queues;
begin
  actor_id := public.require_queue_staff(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  select * into result from public.queues
    where id = p_queue_id and queue_date = d and status = 'cancelled' for update;
  if not found then raise exception 'คืนคิวนี้ไม่ได้ กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  select greatest(pg_catalog.clock_timestamp(), coalesce(max(created_at) + interval '1 microsecond', '-infinity'::timestamptz))
    into restored_time from public.queues
    where queue_date = d and service_group = result.service_group and status = 'waiting';
  update public.queues set status = 'waiting', created_at = restored_time,
    cancelled_at = null, updated_at = restored_time
    where id = result.id returning * into result;
  insert into public.queue_restore_events (queue_id, queue_date, queue_number, service_group, restored_at, staff_id)
    values (result.id, result.queue_date, result.queue_number, result.service_group, restored_time, actor_id);
  return result;
end;
$$;

create or replace function public.queue_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  with recent as (
    select * from public.queues
    where queue_date = (now() at time zone 'Asia/Bangkok')::date
      and status in ('completed', 'skipped', 'cancelled')
    order by updated_at desc, id limit 50
  ), visible as (
    select * from public.queues
    where queue_date = (now() at time zone 'Asia/Bangkok')::date and status = 'waiting'
    union all
    select * from public.queues
    where queue_date = (now() at time zone 'Asia/Bangkok')::date and status = 'calling'
    union all
    select * from recent
  )
  select jsonb_build_object(
    'queue_date', (now() at time zone 'Asia/Bangkok')::date,
    'calling_mode', 'by_group',
    'group_names', (select jsonb_build_object('A', name_a, 'B', name_b) from public.queue_group_config where id = 1),
    'queues', coalesce((
      select jsonb_agg(to_jsonb(v) || jsonb_build_object(
        'call_count', (select count(*) from public.queue_call_events e where e.queue_id = v.id)
      ) order by v.created_at, v.id)
      from visible v
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.call_next(text, uuid) from public, anon, authenticated;
revoke all on function public.call_next_in_group(text, text, uuid) from public, anon, authenticated;
revoke all on function public.restore_cancelled(text, uuid) from public, anon, authenticated;
revoke all on function public.queue_snapshot() from public, anon, authenticated;
grant execute on function public.call_next(text, uuid) to anon;
grant execute on function public.call_next_in_group(text, text, uuid) to anon;
grant execute on function public.restore_cancelled(text, uuid) to anon;
grant execute on function public.queue_snapshot() to anon, authenticated;
notify pgrst, 'reload schema';
commit;

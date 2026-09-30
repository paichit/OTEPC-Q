-- Run once in the Supabase SQL Editor after schema.sql / prior migrations.
-- Existing A001/B001 tickets and history keep their original numbers.
begin;

do $$
declare c record;
begin
  for c in
    select conname from pg_catalog.pg_constraint
    where conrelid = 'public.queues'::regclass and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%queue_number%'
  loop
    execute pg_catalog.format('alter table public.queues drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.queues add constraint queues_number_matches_group
  check (queue_number ~ ('^(' || service_group || '|' || case service_group when 'A' then 'กลุ่มทั่วไป' else 'กลุ่มประสบการณ์' end || ')[0-9]{3,}$'));

create table if not exists public.queue_issue_events (
  queue_id uuid primary key,
  queue_date date not null,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  issued_at timestamptz not null
);
create index if not exists queue_issue_events_recent on public.queue_issue_events (queue_date, issued_at desc);
alter table public.queue_issue_events enable row level security;
revoke all on public.queue_issue_events from public, anon, authenticated;
insert into public.queue_issue_events (queue_id, queue_date, queue_number, service_group, issued_at)
select id, queue_date, queue_number, service_group, created_at from public.queues
on conflict (queue_id) do nothing;

create or replace function public.issue_queue(p_group text, p_request_id uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  n bigint;
  result public.queues;
begin
  if p_group is null or p_group not in ('A', 'B') or p_request_id is null then
    raise exception 'ประเภทบริการหรือรหัสคำขอไม่ถูกต้อง';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  select * into result from public.queues where request_id = p_request_id;
  if found then
    if result.queue_date <> d or result.service_group <> p_group then
      raise exception 'คำขอนี้หมดอายุหรือเป็นของกลุ่มอื่น กรุณาเริ่มรับคิวใหม่';
    end if;
    return result;
  end if;
  select coalesce(max(substring(queue_number from '[0-9]+$')::bigint), 0) + 1 into n
    from public.queues where queue_date = d and service_group = p_group;
  insert into public.queues (queue_date, queue_number, service_group, request_id)
    values (d, (case p_group when 'A' then 'กลุ่มทั่วไป' else 'กลุ่มประสบการณ์' end) || lpad(n::text, greatest(3, length(n::text)), '0'), p_group, p_request_id)
    returning * into result;
  insert into public.queue_issue_events (queue_id, queue_date, queue_number, service_group, issued_at)
    values (result.id, result.queue_date, result.queue_number, result.service_group, result.created_at);
  return result;
end;
$$;

create table if not exists public.queue_restore_events (
  id bigint generated always as identity primary key,
  queue_id uuid not null,
  queue_date date not null,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  restored_at timestamptz not null,
  staff_id uuid not null
);
create index if not exists queue_restore_events_recent on public.queue_restore_events (restored_at desc, id desc);
alter table public.queue_restore_events enable row level security;
revoke all on public.queue_restore_events from public, anon, authenticated;

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
  select greatest(pg_catalog.clock_timestamp(), coalesce(max(created_at) + interval '1 microsecond', '-infinity'::timestamptz))
    into restored_time from public.queues where queue_date = d and status = 'waiting';
  update public.queues set status = 'waiting', created_at = restored_time,
    cancelled_at = null, updated_at = restored_time
    where id = p_queue_id and queue_date = d and status = 'cancelled' returning * into result;
  if not found then raise exception 'คืนคิวนี้ไม่ได้ กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  insert into public.queue_restore_events (queue_id, queue_date, queue_number, service_group, restored_at, staff_id)
    values (result.id, result.queue_date, result.queue_number, result.service_group, restored_time, actor_id);
  return result;
end;
$$;

create or replace function public.queue_report(p_token text, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff(p_token);
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'ช่วงวันที่รายงานไม่ถูกต้อง';
  end if;
  with events as (
    select i.queue_date, i.queue_number, i.service_group, 'issued'::text as event_kind,
      i.issued_at as event_at from public.queue_issue_events i
    union all
    select e.queue_date, e.queue_number,
      case when e.queue_number like 'A%' or e.queue_number like 'กลุ่มทั่วไป%' then 'A' else 'B' end,
      e.event_kind, e.called_at from public.queue_call_events e
    union all
    select c.queue_date, c.queue_number, c.service_group, 'cancelled', c.cancelled_at
      from public.queue_cancel_events c
    union all
    select r.queue_date, r.queue_number, r.service_group, 'restored', r.restored_at
      from public.queue_restore_events r
  )
  select coalesce(jsonb_agg(to_jsonb(e) order by e.event_at desc, e.queue_number), '[]'::jsonb)
    into result from events e
    where (p_from is null or e.queue_date >= p_from)
      and (p_to is null or e.queue_date <= p_to);
  return result;
end;
$$;

create or replace function public.cancelled_queues_current(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff(p_token);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.cancelled_at desc, q.id), '[]'::jsonb)
    into result from public.queues q
    where q.queue_date = (now() at time zone 'Asia/Bangkok')::date and q.status = 'cancelled';
  return result;
end;
$$;

revoke all on function public.restore_cancelled(text, uuid) from public, anon, authenticated;
grant execute on function public.restore_cancelled(text, uuid) to anon;
revoke all on function public.cancelled_queues_current(text) from public, anon, authenticated;
grant execute on function public.cancelled_queues_current(text) to anon;
revoke all on function public.queue_report(text, date, date) from public, anon, authenticated;
grant execute on function public.queue_report(text, date, date) to anon;
notify pgrst, 'reload schema';
commit;

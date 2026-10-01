-- Run once in the Supabase SQL Editor on a new project.
-- All dates are calculated on the DATABASE using Asia/Bangkok.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.queues (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  queue_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  counter_number integer check (counter_number between 1 and 10),
  status text not null default 'waiting' check (status in ('waiting', 'calling', 'completed', 'skipped', 'cancelled')),
  called_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  request_id uuid not null unique,
  unique (queue_date, queue_number),
  constraint queues_number_matches_group check (queue_number ~ ('^(' || service_group || '|' || case service_group when 'A' then 'กลุ่มทั่วไป' else 'กลุ่มประสบการณ์' end || ')[0-9]{3,}$')),
  check (status <> 'calling' or called_at is not null)
);
create index queues_daily_waiting on public.queues (queue_date, created_at, id) where status = 'waiting';
create unique index queues_one_active_call_per_group on public.queues (queue_date, service_group) where status = 'calling';
create index queues_group_waiting on public.queues (queue_date, service_group, created_at, id) where status = 'waiting';
create index queues_daily_history
  on public.queues (queue_date, updated_at desc, id)
  where status in ('completed', 'skipped', 'cancelled');
alter table public.queues enable row level security;
create policy "Public reads today's queues" on public.queues for select to anon, authenticated
  using (queue_date = (now() at time zone 'Asia/Bangkok')::date);
revoke all on public.queues from anon, authenticated;
grant select on public.queues to anon, authenticated;
-- There are intentionally no INSERT/UPDATE/DELETE policies: writes use RPC only.


-- Immutable call attempts survive a daily reset; queue_id is deliberately not a foreign key.
create table public.queue_issue_events (
  queue_id uuid primary key,
  queue_date date not null,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  issued_at timestamptz not null
);
create index queue_issue_events_recent on public.queue_issue_events (queue_date, issued_at desc);
alter table public.queue_issue_events enable row level security;
revoke all on public.queue_issue_events from public, anon, authenticated;

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

-- Immutable cancellation snapshots survive resets just like call events.
create table public.queue_cancel_events (
  id bigint generated always as identity primary key,
  queue_id uuid not null,
  queue_date date not null,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  cancelled_at timestamptz not null
);
create index queue_cancel_events_recent on public.queue_cancel_events (cancelled_at desc, queue_id);
create index queue_cancel_events_queue on public.queue_cancel_events (queue_id, cancelled_at desc);
alter table public.queue_cancel_events enable row level security;
revoke all on public.queue_cancel_events from anon, authenticated;

-- Staff accounts have no email, phone, or Supabase Auth user.
create table public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z][a-z0-9._-]{2,31}$'),
  password_hash text not null check (password_hash ~ '^[$]2a[$]12[$]'),
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.staff_accounts enable row level security;
revoke all on public.staff_accounts from public, anon, authenticated;

create table public.staff_sessions (
  token_hash text primary key,
  staff_id uuid not null references public.staff_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index staff_sessions_staff_expiry on public.staff_sessions (staff_id, expires_at desc);
alter table public.staff_sessions enable row level security;
revoke all on public.staff_sessions from public, anon, authenticated;

create function public.staff_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  account public.staff_accounts;
  new_token text;
  expiry timestamptz := pg_catalog.clock_timestamp() + interval '12 hours';
begin
  if p_username is null or p_username !~ '^[a-z][a-z0-9._-]{2,31}$'
    or p_password is null or length(p_password) < 12 or pg_catalog.octet_length(p_password) > 72 then
    return pg_catalog.jsonb_build_object('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  end if;

  select * into account from public.staff_accounts
    where username = p_username and active = true for update;
  if not found then
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 12));
    return pg_catalog.jsonb_build_object('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  end if;
  if account.locked_until > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('error', 'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง');
  end if;
  if account.password_hash <> extensions.crypt(p_password, account.password_hash) then
    update public.staff_accounts
      set failed_attempts = case when failed_attempts >= 4 then 0 else failed_attempts + 1 end,
          locked_until = case when failed_attempts >= 4 then pg_catalog.clock_timestamp() + interval '15 minutes' else null end
      where id = account.id;
    return pg_catalog.jsonb_build_object('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  end if;

  update public.staff_accounts set failed_attempts = 0, locked_until = null where id = account.id;
  delete from public.staff_sessions where staff_id = account.id and expires_at <= pg_catalog.clock_timestamp();
  new_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.staff_sessions (token_hash, staff_id, expires_at)
    values (pg_catalog.encode(extensions.digest(new_token, 'sha256'), 'hex'), account.id, expiry);
  return pg_catalog.jsonb_build_object('token', new_token, 'username', account.username, 'expires_at', expiry);
end;
$$;

create function public.staff_session(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select pg_catalog.jsonb_build_object('username', a.username, 'expires_at', s.expires_at)
    into result from public.staff_sessions s
    join public.staff_accounts a on a.id = s.staff_id
    where s.token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex')
      and s.expires_at > pg_catalog.clock_timestamp() and a.active;
  return result;
end;
$$;

create function public.staff_logout(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return; end if;
  delete from public.staff_sessions
    where token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex');
end;
$$;

create function public.require_queue_staff(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'เซสชันเจ้าหน้าที่หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' using errcode = '42501';
  end if;
  select a.id into actor from public.staff_sessions s
    join public.staff_accounts a on a.id = s.staff_id
    where s.token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex')
      and s.expires_at > pg_catalog.clock_timestamp() and a.active;
  if actor is null then
    raise exception 'เซสชันเจ้าหน้าที่หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' using errcode = '42501';
  end if;
  return actor;
end;
$$;


create function public.issue_queue(p_group text, p_request_id uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Bangkok')::date;
  n bigint;
  result public.queues;
begin
  if p_group is null or p_group not in ('A', 'B') or p_request_id is null then
    raise exception 'ประเภทบริการหรือรหัสคำขอไม่ถูกต้อง';
  end if;
  -- Shared by all queue mutations: two kiosks/staff actions/resets cannot race.
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

create function public.call_next(p_token text, p_expected uuid default null) returns public.queues
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_queue_staff(p_token);
  raise exception 'ระบบเปลี่ยนเป็นเรียกคิวแยกกลุ่มแล้ว กรุณารีเฟรชหน้าเว็บก่อนเรียกคิว';
end;
$$;

create function public.call_next_in_group(p_token text, p_group text, p_expected uuid default null) returns public.queues
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

create function public.recall_current(p_token text, p_expected uuid) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  d date := (now() at time zone 'Asia/Bangkok')::date;
  result public.queues;
begin
  actor_id := public.require_queue_staff(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  update public.queues set called_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_expected and queue_date = d and status = 'calling' returning * into result;
  if not found then raise exception 'คิวปัจจุบันเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  insert into public.queue_call_events (queue_id, queue_date, queue_number, event_kind, called_at, staff_id)
    values (result.id, result.queue_date, result.queue_number, 'recall', result.called_at, actor_id);
  return result;
end;
$$;

create function public.cancel_waiting(p_token text, p_queue_id uuid) returns public.queues
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

-- Keep a separate audit event when staff returns a cancelled queue to the end of the line.
create table public.queue_restore_events (
  id bigint generated always as identity primary key,
  queue_id uuid not null,
  queue_date date not null,
  queue_number text not null,
  service_group text not null check (service_group in ('A', 'B')),
  restored_at timestamptz not null,
  staff_id uuid not null
);
create index queue_restore_events_recent on public.queue_restore_events (restored_at desc, id desc);
alter table public.queue_restore_events enable row level security;
revoke all on public.queue_restore_events from public, anon, authenticated;

create function public.restore_cancelled(p_token text, p_queue_id uuid) returns public.queues
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

create function public.cancelled_queues_current(p_token text) returns jsonb
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

create function public.queue_call_history(p_token text, p_limit integer default 50) returns jsonb
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

create function public.queue_call_history_current(p_token text) returns jsonb
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

create function public.reset_today(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform public.require_queue_staff(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  delete from public.queues where queue_date = d;
end;
$$;

-- Staff-only event report. Issued rows are available while the queue row still exists;
-- call, cancel and restore events survive a reset.
create function public.queue_report(p_token text, p_from date default null, p_to date default null) returns jsonb
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

-- Shared display names. Internal A/B keys and stored ticket sequence stay stable.
create table if not exists public.queue_group_config (
  id integer primary key check (id = 1),
  name_a text not null default 'กลุ่มทั่วไป',
  name_b text not null default 'กลุ่มประสบการณ์',
  check (char_length(name_a) between 1 and 40 and char_length(name_b) between 1 and 40),
  check (name_a <> name_b and name_a !~ '[[:cntrl:]]' and name_b !~ '[[:cntrl:]]')
);
insert into public.queue_group_config(id) values (1) on conflict do nothing;
alter table public.queue_group_config enable row level security;
drop policy if exists queue_group_names_read on public.queue_group_config;
create policy queue_group_names_read on public.queue_group_config for select to anon, authenticated using (true);
revoke all on public.queue_group_config from anon, authenticated;
grant select on public.queue_group_config to anon, authenticated, service_role;

create or replace function public.set_queue_group_names(p_token text, p_name_a text, p_name_b text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a text := btrim(p_name_a); b text := btrim(p_name_b);
begin
  perform public.require_queue_staff(p_token);
  if a is null or b is null or char_length(a) not between 1 and 40 or char_length(b) not between 1 and 40
     or a = b or a ~ '[[:cntrl:]]' or b ~ '[[:cntrl:]]' then
    raise exception 'ชื่อกลุ่มต้องยาว 1–40 ตัวอักษร ไม่ซ้ำกัน และไม่มีอักขระควบคุม';
  end if;
  update public.queue_group_config set name_a = a, name_b = b where id = 1;
  return jsonb_build_object('A', a, 'B', b);
end;
$$;
revoke all on function public.set_queue_group_names(text, text, text) from public, anon, authenticated;
grant execute on function public.set_queue_group_names(text, text, text) to anon;

-- A single snapshot avoids torn reads and PostgREST's 1,000-row list limit.
create function public.queue_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Each branch can use its own index instead of materializing every row of the day.
  -- Explicit date filters are required because this function runs as its owner.
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

revoke all on function public.issue_queue(text, uuid) from public, anon, authenticated;
revoke all on function public.queue_snapshot() from public, anon, authenticated;
grant execute on function public.issue_queue(text, uuid) to anon, authenticated;
grant execute on function public.queue_snapshot() to anon, authenticated;
revoke all on function public.staff_login(text, text) from public, anon, authenticated;
revoke all on function public.staff_session(text) from public, anon, authenticated;
revoke all on function public.staff_logout(text) from public, anon, authenticated;
revoke all on function public.require_queue_staff(text) from public, anon, authenticated;
revoke all on function public.call_next(text, uuid) from public, anon, authenticated;
revoke all on function public.call_next_in_group(text, text, uuid) from public, anon, authenticated;
revoke all on function public.recall_current(text, uuid) from public, anon, authenticated;
revoke all on function public.cancel_waiting(text, uuid) from public, anon, authenticated;
revoke all on function public.restore_cancelled(text, uuid) from public, anon, authenticated;
revoke all on function public.cancelled_queues_current(text) from public, anon, authenticated;
revoke all on function public.queue_call_history(text, integer) from public, anon, authenticated;
revoke all on function public.queue_call_history_current(text) from public, anon, authenticated;
revoke all on function public.queue_report(text, date, date) from public, anon, authenticated;
revoke all on function public.reset_today(text) from public, anon, authenticated;
grant execute on function public.staff_login(text, text) to anon;
grant execute on function public.staff_session(text) to anon;
grant execute on function public.staff_logout(text) to anon;
grant execute on function public.call_next(text, uuid) to anon;
grant execute on function public.call_next_in_group(text, text, uuid) to anon;
grant execute on function public.recall_current(text, uuid) to anon;
grant execute on function public.cancel_waiting(text, uuid) to anon;
grant execute on function public.restore_cancelled(text, uuid) to anon;
grant execute on function public.cancelled_queues_current(text) to anon;
grant execute on function public.queue_call_history(text, integer) to anon;
grant execute on function public.queue_call_history_current(text) to anon;
grant execute on function public.queue_report(text, date, date) to anon;
grant execute on function public.reset_today(text) to anon;

-- One browser/device owns announcement playback at a time.
create table public.queue_audio_lease (
  singleton boolean primary key default true check (singleton),
  owner_token uuid,
  expires_at timestamptz not null default '-infinity'
);
alter table public.queue_audio_lease enable row level security;
revoke all on public.queue_audio_lease from public, anon, authenticated;

create function public.claim_queue_audio_lease(p_owner uuid, p_ttl_seconds integer default 30)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare claimed boolean;
begin
  if p_owner is null then return false; end if;
  insert into public.queue_audio_lease as lease (singleton, owner_token, expires_at)
    values (true, p_owner, pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => least(greatest(p_ttl_seconds, 10), 60)))
  on conflict (singleton) do update
    set owner_token = excluded.owner_token, expires_at = excluded.expires_at
    where lease.expires_at <= pg_catalog.clock_timestamp() or lease.owner_token = excluded.owner_token
  returning owner_token = p_owner into claimed;
  return coalesce(claimed, false);
end;
$$;

create function public.renew_queue_audio_lease(p_owner uuid, p_ttl_seconds integer default 30)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.queue_audio_lease
    set expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => least(greatest(p_ttl_seconds, 10), 60))
    where singleton and owner_token = p_owner and expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

create function public.release_queue_audio_lease(p_owner uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.queue_audio_lease set owner_token = null, expires_at = pg_catalog.clock_timestamp()
    where singleton and owner_token = p_owner;
  return found;
end;
$$;

revoke all on function public.claim_queue_audio_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.renew_queue_audio_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_queue_audio_lease(uuid) from public, anon, authenticated;
grant execute on function public.claim_queue_audio_lease(uuid, integer) to service_role;
grant execute on function public.renew_queue_audio_lease(uuid, integer) to service_role;
grant execute on function public.release_queue_audio_lease(uuid) to service_role;

-- REALTIME SETUP (run on Supabase; excluded only by local PGlite tests).
alter table public.queues replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queues') then
    alter publication supabase_realtime add table public.queues;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_group_config') then
    alter publication supabase_realtime add table public.queue_group_config;
  end if;
end;
$$;
notify pgrst, 'reload schema';

-- One-time migration for OTEPC Q: staff accounts use usernames only.
-- This requires staff_accounts to be empty. Queue data and call history are preserved.
begin;

do $$ begin
  if exists (select 1 from public.staff_accounts) then
    raise exception 'staff_accounts is not empty; migrate existing staff before running this file';
  end if;
end $$;

drop function if exists public.call_next(uuid);
drop function if exists public.recall_current(uuid);
drop function if exists public.cancel_waiting(uuid);
drop function if exists public.queue_call_history(integer);
drop function if exists public.reset_today();
drop function if exists public.require_queue_staff();
drop table public.staff_accounts;

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

-- The five queue RPCs below retain their queue rules. Each now checks an opaque staff session.
create function public.call_next(p_token text, p_expected uuid default null) returns public.queues
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  d date := (now() at time zone 'Asia/Bangkok')::date;
  next_queue public.queues;
  current_id uuid;
begin
  actor_id := public.require_queue_staff(p_token);
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
begin
  perform public.require_queue_staff(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  update public.queues set status = 'cancelled', cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_queue_id and queue_date = d and status = 'waiting' returning * into result;
  if not found then raise exception 'คิวนี้ไม่ได้อยู่ในรายการรอแล้ว กรุณาโหลดข้อมูลอีกครั้ง'; end if;
  return result;
end;
$$;

create function public.queue_call_history(p_token text, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff(p_token);
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

create function public.reset_today(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform public.require_queue_staff(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('otepc-queue:' || d::text, 0));
  delete from public.queues where queue_date = d;
end;
$$;

revoke all on function public.staff_login(text, text) from public, anon, authenticated;
revoke all on function public.staff_session(text) from public, anon, authenticated;
revoke all on function public.staff_logout(text) from public, anon, authenticated;
revoke all on function public.require_queue_staff(text) from public, anon, authenticated;
revoke all on function public.call_next(text, uuid) from public, anon, authenticated;
revoke all on function public.recall_current(text, uuid) from public, anon, authenticated;
revoke all on function public.cancel_waiting(text, uuid) from public, anon, authenticated;
revoke all on function public.queue_call_history(text, integer) from public, anon, authenticated;
revoke all on function public.reset_today(text) from public, anon, authenticated;
grant execute on function public.staff_login(text, text) to anon;
grant execute on function public.staff_session(text) to anon;
grant execute on function public.staff_logout(text) to anon;
grant execute on function public.call_next(text, uuid) to anon;
grant execute on function public.recall_current(text, uuid) to anon;
grant execute on function public.cancel_waiting(text, uuid) to anon;
grant execute on function public.queue_call_history(text, integer) to anon;
grant execute on function public.reset_today(text) to anon;
commit;

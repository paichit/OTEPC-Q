-- Allow only one display browser across all devices to speak at a time.
create table if not exists public.queue_audio_lease (
  singleton boolean primary key default true check (singleton),
  owner_token uuid,
  expires_at timestamptz not null default '-infinity'
);

alter table public.queue_audio_lease enable row level security;
revoke all on public.queue_audio_lease from public, anon, authenticated;

create or replace function public.claim_queue_audio_lease(p_owner uuid, p_ttl_seconds integer default 30)
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

create or replace function public.renew_queue_audio_lease(p_owner uuid, p_ttl_seconds integer default 30)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.queue_audio_lease
    set expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => least(greatest(p_ttl_seconds, 10), 60))
    where singleton and owner_token = p_owner and expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

create or replace function public.release_queue_audio_lease(p_owner uuid)
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

begin;
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

create or replace function public.queue_snapshot() returns jsonb
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
    'group_names', (select jsonb_build_object('A', name_a, 'B', name_b) from public.queue_group_config where id = 1),
    'queues', coalesce((
      select jsonb_agg(to_jsonb(v) || jsonb_build_object(
        'call_count', (select count(*) from public.queue_call_events e where e.queue_id = v.id)
      ) order by v.created_at, v.id)
      from visible v
    ), '[]'::jsonb)
  );
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_group_config') then
    alter publication supabase_realtime add table public.queue_group_config;
  end if;
end;
$$;
notify pgrst, 'reload schema';

commit;

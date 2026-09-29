-- Existing projects: apply after migrate-snapshot-performance.sql.
-- Keeps all data and permissions unchanged; queue_snapshot returns up to 50 recent rows.
begin;

create or replace function public.queue_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Keep waiting and calling queues complete; only recent terminal states are bounded.
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
    'queues', coalesce((
      select jsonb_agg(to_jsonb(v) || jsonb_build_object(
        'call_count', (select count(*) from public.queue_call_events e where e.queue_id = v.id)
      ) order by v.created_at, v.id)
      from visible v
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.queue_snapshot() from public, anon, authenticated;
grant execute on function public.queue_snapshot() to anon, authenticated;

commit;

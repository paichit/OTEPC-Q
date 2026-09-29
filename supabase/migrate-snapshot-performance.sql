-- Existing projects: apply after migrate-recall-cancel.sql.
-- No data is deleted. The API shape, RLS policies and staff RPC permissions stay unchanged.
-- This small partial index trades extra disk space for faster recent-history reads.
-- CREATE INDEX takes a write lock while building; apply during a quiet period.
begin;

create index if not exists queues_daily_history
  on public.queues (queue_date, updated_at desc, id)
  where status in ('completed', 'skipped', 'cancelled');

create or replace function public.queue_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Each branch can use its own index instead of materializing every row of the day.
  -- Explicit date filters are required because this function runs as its owner.
  with recent as (
    select * from public.queues
    where queue_date = (now() at time zone 'Asia/Bangkok')::date
      and status in ('completed', 'skipped', 'cancelled')
    order by updated_at desc, id limit 20
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

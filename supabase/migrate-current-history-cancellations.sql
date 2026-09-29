-- Existing projects: apply after migrate-current-and-full-call-history.sql.
-- Include cancelled queues from the active queue set in current-round history.
-- No queue or call-event rows are changed.
begin;

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
    select q.id as queue_id, coalesce(q.cancelled_at, q.updated_at) as activity_at,
      jsonb_build_object(
        'queue_id', q.id, 'queue_date', q.queue_date, 'queue_number', q.queue_number,
        'status', 'cancelled', 'call_count', 0, 'recall_count', 0,
        'cancelled_at', coalesce(q.cancelled_at, q.updated_at), 'events', '[]'::jsonb
      ) as item
    from public.queues q
    where q.queue_date = (now() at time zone 'Asia/Bangkok')::date
      and q.status = 'cancelled'
  )
  select coalesce(jsonb_agg(item order by activity_at desc, queue_id), '[]'::jsonb)
    into result from (
      select * from called
      union all
      select * from cancelled
    ) entries;
  return result;
end;
$$;

revoke all on function public.queue_call_history_current(text) from public, anon, authenticated;
grant execute on function public.queue_call_history_current(text) to anon;
notify pgrst, 'reload schema';

commit;

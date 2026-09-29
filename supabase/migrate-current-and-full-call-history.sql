-- Existing projects: apply after the queue history table and staff RPCs exist.
-- No table or queue data is changed. The existing history RPC keeps its signature,
-- but now returns every historical queue; the new RPC filters to queues still in today's queue set.
begin;

create or replace function public.queue_call_history(p_token text, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_queue_staff(p_token);
  -- Keep p_limit in the signature for backwards compatibility; this view returns all history.
  with recent as (
    select queue_id, max(called_at) as last_called_at
    from public.queue_call_events group by queue_id
    order by last_called_at desc
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'queue_id', r.queue_id, 'queue_date', e.queue_date, 'queue_number', e.queue_number,
    'call_count', count_data.call_count, 'recall_count', count_data.call_count - 1,
    'last_called_at', r.last_called_at, 'events', count_data.events
  ) order by r.last_called_at desc), '[]'::jsonb) into result
  from current_events r
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

revoke all on function public.queue_call_history(text, integer) from public, anon, authenticated;
revoke all on function public.queue_call_history_current(text) from public, anon, authenticated;
grant execute on function public.queue_call_history(text, integer) to anon;
grant execute on function public.queue_call_history_current(text) to anon;

-- Refresh PostgREST's RPC schema cache so the new function becomes callable immediately.
notify pgrst, 'reload schema';

commit;

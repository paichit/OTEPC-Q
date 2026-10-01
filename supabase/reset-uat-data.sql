-- Clear OTEPC Q application data for a fresh UAT run.
-- Keep staff_accounts and queue_audio_lease. This does not delete Storage audio files.
-- Run only on the intended Supabase project, after saving any reports you need.
begin;

truncate table
  public.queues,
  public.queue_issue_events,
  public.queue_call_events,
  public.queue_cancel_events,
  public.queue_restore_events,
  public.staff_sessions,
  public.queue_group_config
restart identity;

-- The app and Cloud TTS expect this singleton row to exist.
insert into public.queue_group_config (id) values (1);

commit;

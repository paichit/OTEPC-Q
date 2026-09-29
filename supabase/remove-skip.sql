-- Run once if an earlier OTEPC Q schema or migration already created Skip.
-- Historical skipped rows remain readable; only the action is removed.
drop function if exists public.skip_queue(uuid);
drop function if exists public.skip_queue(uuid, integer);

-- Private cache for Google Cloud Text-to-Speech output.
-- The Edge Function uses its service-role key; clients have no direct access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('queue-tts', 'queue-tts', false, 262144, array['audio/mpeg'])
on conflict (id) do nothing;

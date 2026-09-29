-- Apply once to an existing OTEPC Q database after username-only authentication.
-- Only new logins receive a 12-hour session. Existing sessions keep their expiry.
create or replace function public.staff_login(p_username text, p_password text) returns jsonb
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

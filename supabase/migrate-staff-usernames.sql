-- Apply once after the existing OTEPC Q schema. Does not change queues or queue RPCs.
create table if not exists public.staff_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z][a-z0-9._-]{2,31}$'),
  created_at timestamptz not null default now()
);
alter table public.staff_accounts enable row level security;
revoke all on public.staff_accounts from public, anon, authenticated;
grant select on public.staff_accounts to service_role;

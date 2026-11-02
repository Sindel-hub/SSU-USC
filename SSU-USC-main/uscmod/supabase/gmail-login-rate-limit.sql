-- Apply only with explicit approval, in one transaction, after target verification.
-- Canonical migration: migrations/202611030001_gmail_login_rate_limit.sql.
-- Shared database budgets apply to all Edge instances. No raw emails, IPs or passwords.
create table if not exists public.gmail_login_rate_limits (
  bucket_key text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
alter table public.gmail_login_rate_limits enable row level security;
-- Only the SECURITY DEFINER RPC may access counters; no browser policies.
revoke all on table public.gmail_login_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_gmail_login_budget(p_identity_hash text, p_client_hash text default null)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  window_at timestamptz;
  item record;
  count_now integer;
begin
  if p_identity_hash is null or p_identity_hash !~ '^[a-f0-9]{64}$'
    or (p_client_hash is not null and p_client_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid rate-limit key';
  end if;
  -- One short transaction serializes the small shared budgets across instances.
  perform pg_advisory_xact_lock(714021105);
  window_at := date_trunc('minute', clock_timestamp());
  delete from public.gmail_login_rate_limits where expires_at <= clock_timestamp();
  for item in
    select key, ceiling from (
      select 'global'::text as key, 120 as ceiling, 0 as priority
      union all select 'client:' || p_client_hash, 20, 1 where p_client_hash is not null
      union all select 'identity:' || p_identity_hash, 5, 2
    ) as budgets order by priority
  loop
    insert into public.gmail_login_rate_limits as current_bucket (bucket_key, window_start, attempts, expires_at)
      values (item.key, window_at, 1, window_at + interval '2 minutes')
    on conflict (bucket_key) do update set
      attempts = case when current_bucket.window_start = excluded.window_start then least(current_bucket.attempts + 1, 121) else 1 end,
      window_start = excluded.window_start,
      expires_at = excluded.expires_at
    returning attempts into count_now;
    if count_now > item.ceiling then return false; end if;
  end loop;
  return true;
end;
$$;
alter function public.consume_gmail_login_budget(text, text) owner to postgres;
revoke all on function public.consume_gmail_login_budget(text, text) from public, anon, authenticated;
grant execute on function public.consume_gmail_login_budget(text, text) to service_role;

-- Make the new RPC visible after the surrounding transaction commits.
notify pgrst, 'reload schema';

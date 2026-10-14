-- Only the Edge Function's service role can access OAuth credentials and deliveries.
create table public.facebook_connection (
  id boolean primary key default true check (id),
  page_id text not null, page_name text not null, token_cipher text not null,
  connected_by text not null, connected_at timestamptz not null default now()
);
create table public.facebook_oauth_sessions (
  state_hash text primary key, uid text not null, verifier_hash text not null,
  expires_at timestamptz not null, phase text not null default 'started', pages_cipher text
);
create table public.facebook_deliveries (
  announcement_id text primary key, page_id text not null,
  status text not null check (status in ('sending','failed','succeeded','uncertain')),
  message text not null, image_url text, post_id text, error text,
  attempts integer not null default 1, updated_at timestamptz not null default now()
);
alter table public.facebook_connection enable row level security;
alter table public.facebook_oauth_sessions enable row level security;
alter table public.facebook_deliveries enable row level security;
revoke all on public.facebook_connection, public.facebook_oauth_sessions, public.facebook_deliveries from anon, authenticated;
grant all on public.facebook_connection, public.facebook_oauth_sessions, public.facebook_deliveries to service_role;

-- An atomic reservation prevents concurrent clicks/retries from creating duplicate Page posts.
create function public.claim_facebook_delivery(p_id text, p_page text, p_message text, p_image text)
returns setof public.facebook_deliveries language plpgsql security definer set search_path = public as $$
begin
  return query insert into public.facebook_deliveries as d (announcement_id,page_id,status,message,image_url)
  values(p_id,p_page,'sending',p_message,p_image)
  on conflict (announcement_id) do update set status='sending',error=null,attempts=d.attempts+1,updated_at=now()
  where d.status='failed' and d.page_id=p_page
  returning d.*;
end;
$$;
revoke all on function public.claim_facebook_delivery(text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_facebook_delivery(text,text,text,text) to service_role;

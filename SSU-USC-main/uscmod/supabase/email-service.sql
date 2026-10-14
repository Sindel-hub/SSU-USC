-- SSU USC Supabase-backed student + officer email service
-- Run this once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.student_email_accounts (
  firebase_uid text primary key,
  account_role text not null default 'student',
  requested_email text,
  verified_email text,
  complaints boolean not null default true,
  elections boolean not null default true,
  news boolean not null default true,
  recovery boolean not null default true,
  verification_token_hash text,
  verification_expires_at timestamptz,
  verification_sent_at timestamptz,
  verified_at timestamptz,
  last_scan_at timestamptz,
  election_open_key text,
  election_results_key text,
  verification_day date,
  verification_count integer not null default 0 check (verification_count >= 0),
  recovery_day date,
  recovery_count integer not null default 0 check (recovery_count >= 0),
  recovery_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- Safe migration for projects that created the table before officer Gmail support.
alter table public.student_email_accounts
  add column if not exists account_role text not null default 'student';

create index if not exists student_email_accounts_role_idx
  on public.student_email_accounts (account_role);

create unique index if not exists student_email_accounts_verified_email_unique
  on public.student_email_accounts (lower(verified_email))
  where verified_email is not null and verified_email <> '';

create index if not exists student_email_accounts_requested_email_idx
  on public.student_email_accounts (lower(requested_email));

create table if not exists public.email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text,
  recipient text not null,
  kind text not null,
  source_key text,
  status text not null check (status in ('sent','failed')),
  provider_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists email_delivery_log_uid_created_idx
  on public.email_delivery_log (firebase_uid, created_at desc);

alter table public.student_email_accounts enable row level security;
alter table public.email_delivery_log enable row level security;

-- Browser clients must never read or write these tables directly.
-- The Edge Functions use the Supabase secret/service key and bypass RLS.
revoke all on table public.student_email_accounts from anon, authenticated;
revoke all on table public.email_delivery_log from anon, authenticated;

grant all on table public.student_email_accounts to service_role;
grant all on table public.email_delivery_log to service_role;

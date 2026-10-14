-- Schedule the Supabase email notification worker every 5 minutes.
-- BEFORE RUNNING: replace REPLACE_WITH_THE_SAME_EMAIL_WORKER_SECRET with the
-- same random value you saved as the Edge Function secret EMAIL_WORKER_SECRET.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://svgfxatigtjdrwzibjbu.supabase.co',
  'usc_email_project_url'
);

select vault.create_secret(
  'sb_publishable_tGz7URzV92fr3M8RSRbHcg_BOy9Oqxl',
  'usc_email_publishable_key'
);

select vault.create_secret(
  'REPLACE_WITH_THE_SAME_EMAIL_WORKER_SECRET',
  'usc_email_worker_secret'
);

select cron.schedule(
  'usc-email-worker-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'usc_email_project_url' order by created_at desc limit 1)
      || '/functions/v1/usc-email-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'usc_email_publishable_key' order by created_at desc limit 1),
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'usc_email_worker_secret' order by created_at desc limit 1)
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

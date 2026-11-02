-- OPTIONAL cleanup only AFTER authorized rollback to usc-email v21.
-- Never run while the updated Gmail-login function is live.
-- Confirm these objects were absent before this rollout and have no new consumers.
-- This discards only the newly introduced temporary rate-limit counters.
-- Requires separate explicit approval. Run in one transaction; no CASCADE.
drop function if exists public.consume_gmail_login_budget(text, text);
drop table if exists public.gmail_login_rate_limits;
notify pgrst, 'reload schema';

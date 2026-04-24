-- =============================================================
-- Phase 4b: second logo variant for dark-background contexts
-- Run this ONCE in the Supabase SQL Editor, after phase4-branding.sql.
-- =============================================================

-- Existing `company_logo` is the "light-background" logo (dark text,
-- used on the PDF, Excel, email body). This new row is the
-- "dark-background" variant (light text), used on the configurator
-- header and anywhere else with a dark backdrop.
insert into public.admin_settings (setting_key, setting_value)
values ('company_logo_dark', '')
  on conflict (setting_key) do nothing;

-- =============================================================
-- Phase 1: Authentication + user profiles
-- Run this ONCE in the Supabase SQL Editor, in order.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Profiles table (app-level user info keyed to auth.users)
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'designer' check (role in ('admin', 'lead_designer', 'designer')),
  must_change_password boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_active_idx on public.profiles(active);

-- -------------------------------------------------------------
-- 2. Helper: is_admin() — safe for use inside RLS policies.
--    SECURITY DEFINER bypasses RLS so the function can read the
--    profiles table without triggering its own policy recursively.
-- -------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' and active = true
     from public.profiles
     where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;

-- -------------------------------------------------------------
-- 3. RLS for profiles
-- -------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_self_read"    on public.profiles;
drop policy if exists "profiles_admin_read"   on public.profiles;
drop policy if exists "profiles_self_update"  on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;

create policy "profiles_self_read"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_admin_read"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- Users can only update must_change_password on their own row
-- (password itself is updated via Supabase Auth API, not this table).
create policy "profiles_self_update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_admin_update"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Inserts and deletes happen through the server-side admin API only
-- (which uses the service_role key and bypasses RLS).

-- -------------------------------------------------------------
-- 4. Tighten RLS on existing app tables so only authenticated
--    users can read/write. Admin operations already go through the
--    server-side API with the service_role key.
-- -------------------------------------------------------------
-- products
drop policy if exists "products_anon_read"  on public.products;
drop policy if exists "products_auth_read"  on public.products;
drop policy if exists "products_auth_write" on public.products;
create policy "products_auth_read"
  on public.products for select
  to authenticated using (true);
create policy "products_auth_write"
  on public.products for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- install_rates
drop policy if exists "install_rates_anon_read"  on public.install_rates;
drop policy if exists "install_rates_auth_read"  on public.install_rates;
drop policy if exists "install_rates_auth_write" on public.install_rates;
create policy "install_rates_auth_read"
  on public.install_rates for select
  to authenticated using (true);
create policy "install_rates_auth_write"
  on public.install_rates for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- install_config
drop policy if exists "install_config_anon_read"  on public.install_config;
drop policy if exists "install_config_auth_read"  on public.install_config;
drop policy if exists "install_config_auth_write" on public.install_config;
create policy "install_config_auth_read"
  on public.install_config for select
  to authenticated using (true);
create policy "install_config_auth_write"
  on public.install_config for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- admin_settings
drop policy if exists "admin_settings_anon_read"  on public.admin_settings;
drop policy if exists "admin_settings_auth_read"  on public.admin_settings;
drop policy if exists "admin_settings_auth_write" on public.admin_settings;
create policy "admin_settings_auth_read"
  on public.admin_settings for select
  to authenticated using (true);
create policy "admin_settings_auth_write"
  on public.admin_settings for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------
-- 5. updated_at trigger for profiles
-- -------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- 5b. Lockdown trigger: non-admin users updating their own row
--     must NOT be able to change role, active, or email. (RLS
--     allows them to update their row for must_change_password,
--     full_name, etc — this trigger guards the privileged fields.)
-- -------------------------------------------------------------
create or replace function public.guard_profile_self_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.id and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Users cannot change their own role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Users cannot change their own active status';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Users cannot change their own email';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- -------------------------------------------------------------
-- 5c. RPC: clear_my_password_change_flag()
--     Called by a user after they've successfully updated their
--     own password. SECURITY DEFINER so it bypasses RLS, but
--     scoped to auth.uid() so users can only clear their own flag.
-- -------------------------------------------------------------
create or replace function public.clear_my_password_change_flag()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set must_change_password = false
  where id = auth.uid();
$$;

grant execute on function public.clear_my_password_change_flag() to authenticated;

-- -------------------------------------------------------------
-- 6. Now bootstrap the first admin.
--    STEP A (you do this in the Supabase Dashboard, NOT here):
--      Authentication → Users → "Add user" (NOT "Invite user")
--      Email:    brad@enfuzeatlanta.com
--      Password: EnfuzeSetup2026!
--      Auto-confirm: checked
--
--    STEP B: after creating that user in the Dashboard, uncomment
--    and run the block below. It inserts the matching profile row
--    with role='admin' and flags the password as needing a change
--    on first login.
-- -------------------------------------------------------------

-- insert into public.profiles (id, email, full_name, role, must_change_password)
-- select id, email, 'Brad Young', 'admin', true
-- from auth.users
-- where email = 'brad@enfuzeatlanta.com';

-- -------------------------------------------------------------
-- 7. Cleanup: the old single-admin password row is no longer used.
--    Run this once you've confirmed you can log in as the new admin.
-- -------------------------------------------------------------
-- delete from public.admin_settings where setting_key = 'admin_password';

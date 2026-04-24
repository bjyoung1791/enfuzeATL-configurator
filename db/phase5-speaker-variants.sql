-- =============================================================
-- Phase 5: Speaker/sub variant grouping
--
-- Adds optional `variant_group` and `variant_color` columns to the
-- products table. SKUs sharing a variant_group are treated as color
-- variants of the same logical product in the configurator — the
-- type dropdown shows one entry per group, and a color dropdown
-- appears when the group has 2+ variants.
--
-- Run this ONCE in the Supabase SQL Editor.
-- =============================================================

alter table public.products
  add column if not exists variant_group text,
  add column if not exists variant_color text;

create index if not exists products_variant_group_idx on public.products(variant_group);

-- -------------------------------------------------------------
-- Seed existing wall/soffit speakers so the UI knows they're
-- color variants of the same thing. Other speakers / subs stay
-- un-grouped (one SKU = one standalone option).
-- -------------------------------------------------------------
update public.products
  set variant_group = 'wall_soffit_5', variant_color = 'Black'
  where sku = 'SPK-5-870-BK';

update public.products
  set variant_group = 'wall_soffit_5', variant_color = 'White'
  where sku = 'SPK-5-870-WH';

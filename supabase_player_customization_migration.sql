-- Player avatar / my room migration
-- Safe to run after the existing kredo-quest schema.
create table if not exists public.player_customizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avatar_config jsonb not null default '{"hairStyle":"short","hairColor":"black","outfit":"work","accessory":"none","effect":"none"}'::jsonb,
  room_theme text not null default 'basic',
  room_items jsonb not null default '["desk","chair","plant"]'::jsonb,
  owned_items jsonb not null default '{"skins":[],"furniture":["desk","chair","plant"]}'::jsonb,
  spent_points integer not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.player_customizations enable row level security;

drop policy if exists "player_customizations_select_own" on public.player_customizations;
create policy "player_customizations_select_own"
on public.player_customizations for select
using (auth.uid() = user_id);

drop policy if exists "player_customizations_insert_own" on public.player_customizations;
create policy "player_customizations_insert_own"
on public.player_customizations for insert
with check (auth.uid() = user_id);

drop policy if exists "player_customizations_update_own" on public.player_customizations;
create policy "player_customizations_update_own"
on public.player_customizations for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on public.player_customizations from anon;
revoke all on public.player_customizations from authenticated;
grant select, insert, update on public.player_customizations to authenticated;

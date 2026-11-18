-- Daily login bonus: award 2 points once per Japan-local calendar day.
-- The private ledger cannot be read or written directly through the public Data API.

create schema if not exists private authorization postgres;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.kredo_daily_login_bonuses (
  user_id uuid not null references auth.users(id) on delete cascade,
  bonus_date date not null,
  points integer not null default 2 check (points = 2),
  awarded_at timestamptz not null default now(),
  primary key (user_id, bonus_date)
);

alter table private.kredo_daily_login_bonuses disable row level security;
revoke all on table private.kredo_daily_login_bonuses from public, anon, authenticated;

create or replace function public.kredo_claim_daily_login_bonus()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_bonus_date date := (now() at time zone 'Asia/Tokyo')::date;
  v_total bigint;
  v_rows integer := 0;
  v_awarded boolean := false;
begin
  if v_user_id is null then
    raise exception 'login_required' using errcode = '42501';
  end if;

  select coalesce(p.total_points, 0)::bigint
    into v_total
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  insert into private.kredo_daily_login_bonuses (user_id, bonus_date, points)
  values (v_user_id, v_bonus_date, 2)
  on conflict (user_id, bonus_date) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.profiles p
       set total_points = coalesce(p.total_points, 0) + 2,
           updated_at = now()
     where p.id = v_user_id
     returning p.total_points::bigint into v_total;
    v_awarded := true;
  end if;

  return jsonb_build_object(
    'awarded', v_awarded,
    'points', case when v_awarded then 2 else 0 end,
    'bonus_date', v_bonus_date,
    'total_points', v_total
  );
end;
$function$;

revoke all on function public.kredo_claim_daily_login_bonus() from public, anon, authenticated;
grant execute on function public.kredo_claim_daily_login_bonus() to authenticated;

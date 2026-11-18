-- Let signed-in users update only their own profile image URL and profile timestamp.
-- Keep total_points and other profile fields protected from direct client updates.
grant update (avatar_url, updated_at) on table public.profiles to authenticated;

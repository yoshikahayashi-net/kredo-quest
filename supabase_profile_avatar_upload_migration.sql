-- Profile image uploads for CredoQuest.
-- Public reads are intentional for displaying icons in the ranking.
-- Upload/update/delete access is restricted to the authenticated user's own folder.

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatars_select_own" on storage.objects;
drop policy if exists "profile_avatars_insert_own" on storage.objects;
drop policy if exists "profile_avatars_update_own" on storage.objects;
drop policy if exists "profile_avatars_delete_own" on storage.objects;

create policy "profile_avatars_select_own"
on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "profile_avatars_insert_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "profile_avatars_update_own"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "profile_avatars_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

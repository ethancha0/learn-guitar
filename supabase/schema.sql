-- Run this in the Supabase SQL editor for the project connected to the app.

create table if not exists public.songs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  artist text not null default 'Imported',
  duration_sec integer not null default 0,
  bpm integer not null default 120,
  difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  tab_path text not null,
  audio_path text not null,
  tab_file_name text not null,
  audio_file_names text[] not null default '{}',
  youtube_source jsonb,
  created_at timestamptz not null default now()
);

alter table public.songs
  add column if not exists youtube_source jsonb;

alter table public.songs enable row level security;

drop policy if exists "Users can read their songs" on public.songs;
create policy "Users can read their songs"
  on public.songs for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their songs" on public.songs;
create policy "Users can insert their songs"
  on public.songs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their songs" on public.songs;
create policy "Users can update their songs"
  on public.songs for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their songs" on public.songs;
create policy "Users can delete their songs"
  on public.songs for delete
  to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('song-files', 'song-files', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload their song files" on storage.objects;
create policy "Users can upload their song files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'song-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can read their song files" on storage.objects;
create policy "Users can read their song files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'song-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can update their song files" on storage.objects;
create policy "Users can update their song files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'song-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'song-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can delete their song files" on storage.objects;
create policy "Users can delete their song files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'song-files'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

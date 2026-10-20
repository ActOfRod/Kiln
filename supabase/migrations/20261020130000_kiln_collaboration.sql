-- KILN live collaboration: link-shared rooms.
--
-- Access model: a share link carries a room ID and a random secret. Only the
-- SHA-256 hash of the secret is stored. Browsers use the public publishable key,
-- which can only call the functions below; the tables themselves have RLS enabled
-- with no policies and no table privileges for anon/authenticated users.
-- Re-running this migration is safe.

create table if not exists public.kiln_rooms (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (char_length(name) between 1 and 100),
  project jsonb not null check (jsonb_typeof(project) = 'object'),
  clocks jsonb not null default '{}'::jsonb check (jsonb_typeof(clocks) = 'object'),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.kiln_rooms is
  'KILN shared song rooms. project = latest merged song snapshot; clocks = per-entity last-writer stamps used to merge concurrent edits.';

create table if not exists public.kiln_room_assets (
  room_id uuid not null references public.kiln_rooms (id) on delete cascade,
  asset_id text not null check (asset_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  chunk_index integer not null check (chunk_index >= 0),
  chunk_count integer not null check (chunk_count between 1 and 120),
  data bytea not null check (octet_length(data) between 1 and 1048576),
  created_at timestamptz not null default now(),
  primary key (room_id, asset_id, chunk_index),
  check (chunk_index < chunk_count)
);

comment on table public.kiln_room_assets is
  'Original audio files used by a shared song, split into ordered chunks. Assets are immutable once written.';

alter table public.kiln_rooms enable row level security;
alter table public.kiln_room_assets enable row level security;
revoke all on table public.kiln_rooms from anon, authenticated;
revoke all on table public.kiln_room_assets from anon, authenticated;

create or replace function public.kiln_secret_hash(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
$$;

create or replace function public.kiln_assert_access(p_room uuid, p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_secret is null or char_length(p_secret) < 32 or not exists (
    select 1 from public.kiln_rooms r
    where r.id = p_room and r.secret_hash = public.kiln_secret_hash(p_secret)
  ) then
    raise exception 'KILN room not found or link is invalid' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.kiln_create_room(
  p_name text,
  p_secret text,
  p_project jsonb,
  p_clocks jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  room_id uuid;
begin
  if p_secret is null or char_length(p_secret) < 32 or char_length(p_secret) > 200 then
    raise exception 'Share secret must contain at least 32 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_project) <> 'object' or pg_column_size(p_project) > 5000000 then
    raise exception 'Song is missing or larger than 5 MB' using errcode = '22023';
  end if;
  insert into public.kiln_rooms (secret_hash, name, project, clocks)
  values (
    public.kiln_secret_hash(p_secret),
    left(coalesce(nullif(btrim(p_name), ''), 'Untitled'), 100),
    p_project,
    coalesce(p_clocks, '{}'::jsonb)
  )
  returning id into room_id;
  return room_id;
end;
$$;

create or replace function public.kiln_get_room(p_room uuid, p_secret text)
returns table (name text, project jsonb, clocks jsonb, revision bigint, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.kiln_assert_access(p_room, p_secret);
  return query
    select r.name, r.project, r.clocks, r.revision, r.updated_at
    from public.kiln_rooms r
    where r.id = p_room;
end;
$$;

-- Optimistic concurrency: returns the new revision, or null when another
-- collaborator saved first (the client merges and retries).
create or replace function public.kiln_save_room(
  p_room uuid,
  p_secret text,
  p_project jsonb,
  p_clocks jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_revision bigint;
begin
  perform public.kiln_assert_access(p_room, p_secret);
  if jsonb_typeof(p_project) <> 'object' or jsonb_typeof(p_clocks) <> 'object'
    or pg_column_size(p_project) + pg_column_size(p_clocks) > 6000000 then
    raise exception 'Song is invalid or larger than 5 MB' using errcode = '22023';
  end if;
  update public.kiln_rooms r
  set project = p_project,
      clocks = p_clocks,
      name = left(coalesce(nullif(btrim(p_project ->> 'name'), ''), r.name), 100),
      revision = r.revision + 1,
      updated_at = now()
  where r.id = p_room and r.revision = p_expected_revision
  returning r.revision into next_revision;
  return next_revision;
end;
$$;

create or replace function public.kiln_put_asset_chunk(
  p_room uuid,
  p_secret text,
  p_asset text,
  p_index integer,
  p_count integer,
  p_data text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  bytes bytea := decode(p_data, 'base64');
begin
  perform public.kiln_assert_access(p_room, p_secret);
  if (
    select coalesce(sum(octet_length(a.data)), 0) + octet_length(bytes)
    from public.kiln_room_assets a
    where a.room_id = p_room
  ) > 300 * 1024 * 1024 then
    raise exception 'This shared song has reached its 300 MB audio limit' using errcode = '54000';
  end if;
  insert into public.kiln_room_assets (room_id, asset_id, chunk_index, chunk_count, data)
  values (p_room, p_asset, p_index, p_count, bytes)
  on conflict (room_id, asset_id, chunk_index) do nothing;
end;
$$;

create or replace function public.kiln_get_asset_chunk(
  p_room uuid,
  p_secret text,
  p_asset text,
  p_index integer
)
returns table (chunk_count integer, data text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.kiln_assert_access(p_room, p_secret);
  return query
    select a.chunk_count, encode(a.data, 'base64')
    from public.kiln_room_assets a
    where a.room_id = p_room and a.asset_id = p_asset and a.chunk_index = p_index;
end;
$$;

-- Assets whose chunks have all been uploaded.
create or replace function public.kiln_list_assets(p_room uuid, p_secret text)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.kiln_assert_access(p_room, p_secret);
  return query
    select a.asset_id
    from public.kiln_room_assets a
    where a.room_id = p_room
    group by a.asset_id
    having count(*) = max(a.chunk_count);
end;
$$;

-- Maintainer-only cleanup, for example: select public.kiln_purge_rooms(interval '180 days');
create or replace function public.kiln_purge_rooms(p_idle interval)
returns integer
language sql
volatile
set search_path = ''
as $$
  with removed as (
    delete from public.kiln_rooms r where r.updated_at < now() - p_idle returning 1
  )
  select count(*)::integer from removed;
$$;

revoke all on function public.kiln_secret_hash(text) from public, anon, authenticated;
revoke all on function public.kiln_assert_access(uuid, text) from public, anon, authenticated;
revoke all on function public.kiln_purge_rooms(interval) from public, anon, authenticated;
revoke all on function public.kiln_create_room(text, text, jsonb, jsonb) from public;
revoke all on function public.kiln_get_room(uuid, text) from public;
revoke all on function public.kiln_save_room(uuid, text, jsonb, jsonb, bigint) from public;
revoke all on function public.kiln_put_asset_chunk(uuid, text, text, integer, integer, text) from public;
revoke all on function public.kiln_get_asset_chunk(uuid, text, text, integer) from public;
revoke all on function public.kiln_list_assets(uuid, text) from public;
grant execute on function public.kiln_create_room(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.kiln_get_room(uuid, text) to anon, authenticated;
grant execute on function public.kiln_save_room(uuid, text, jsonb, jsonb, bigint) to anon, authenticated;
grant execute on function public.kiln_put_asset_chunk(uuid, text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.kiln_get_asset_chunk(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.kiln_list_assets(uuid, text) to anon, authenticated;

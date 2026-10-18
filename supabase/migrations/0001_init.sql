-- F1 Team Principal Online - initial schema
-- Run with: supabase db push   (or paste into the Supabase SQL editor)
--
-- Design notes
-- * Auth accounts live in auth.users. A profiles row mirrors the username.
-- * Career state is a single JSONB snapshot per lobby. It is written only by
--   Edge Functions using the service role (which bypasses RLS); browser clients
--   may read it but never write it, so results and balances cannot be forged.
-- * Lobby creation is the one place the browser writes career data, because the
--   shared engine seeds the snapshot client-side for the offline dev backend.
--   See README ("Production hardening") for the server-side alternative.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Lobbies and membership
-- ---------------------------------------------------------------------------
create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  host_user_id uuid not null references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  career_id uuid not null default gen_random_uuid(),
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists lobbies_invite_code_idx on public.lobbies (invite_code);
create index if not exists lobbies_public_idx on public.lobbies ((settings ->> 'isPublic'));

create table if not exists public.lobby_members (
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  team_id text,
  is_host boolean not null default false,
  online boolean not null default false,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);

create index if not exists lobby_members_user_idx on public.lobby_members (user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_lobby_idx on public.chat_messages (lobby_id, created_at);

create table if not exists public.careers (
  id uuid primary key,
  lobby_id uuid not null unique references public.lobbies (id) on delete cascade,
  version integer not null default 1,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS helper functions (security definer avoids recursive RLS lookups)
-- ---------------------------------------------------------------------------
create or replace function public.is_lobby_member(p_lobby uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lobby_members
    where lobby_id = p_lobby and user_id = p_user
  );
$$;

create or replace function public.is_lobby_host(p_lobby uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lobbies
    where id = p_lobby and host_user_id = p_user
  );
$$;

create or replace function public.join_lobby_by_code(p_code text, p_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.lobbies;
begin
  if auth.uid() is null then
    raise exception 'Sign in to join a lobby.';
  end if;

  select * into v_lobby from public.lobbies where upper(invite_code) = upper(p_code);
  if not found then
    raise exception 'No lobby found with that invitation code.';
  end if;

  if exists (
    select 1 from public.lobby_members
    where lobby_id = v_lobby.id and user_id = auth.uid()
  ) then
    update public.lobby_members
      set online = true, last_seen = now(), username = p_username
      where lobby_id = v_lobby.id and user_id = auth.uid();
    return v_lobby.id;
  end if;

  if (select count(*) from public.lobby_members where lobby_id = v_lobby.id) >=
     coalesce((v_lobby.settings ->> 'maxPlayers')::int, 6) then
    raise exception 'This lobby is full.';
  end if;

  if coalesce((v_lobby.settings ->> 'requireApproval')::boolean, false) then
    raise exception 'This lobby requires host approval to join.';
  end if;

  insert into public.lobby_members (lobby_id, user_id, username, is_host, online, last_seen)
  values (v_lobby.id, auth.uid(), p_username, false, true, now())
  on conflict (lobby_id, user_id) do update
    set online = true, last_seen = now(), username = excluded.username;

  return v_lobby.id;
end;
$$;

revoke all on function public.join_lobby_by_code(text, text) from public;
grant execute on function public.join_lobby_by_code(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.careers enable row level security;

-- Profiles
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Lobbies
drop policy if exists lobbies_select_member on public.lobbies;
create policy lobbies_select_member on public.lobbies for select
  using (host_user_id = auth.uid() or public.is_lobby_member(id) or (settings ->> 'isPublic') = 'true');

drop policy if exists lobbies_insert_host on public.lobbies;
create policy lobbies_insert_host on public.lobbies for insert
  with check (host_user_id = auth.uid());

drop policy if exists lobbies_update_host on public.lobbies;
create policy lobbies_update_host on public.lobbies for update
  using (host_user_id = auth.uid()) with check (host_user_id = auth.uid());

drop policy if exists lobbies_delete_host on public.lobbies;
create policy lobbies_delete_host on public.lobbies for delete using (host_user_id = auth.uid());

-- Members
drop policy if exists members_select_lobby on public.lobby_members;
create policy members_select_lobby on public.lobby_members for select
  using (user_id = auth.uid() or public.is_lobby_member(lobby_id) or public.is_lobby_host(lobby_id));

-- Members: joins go through join_lobby_by_code (capacity/approval enforced there);
-- direct inserts are allowed only for the host creating their own row.
drop policy if exists members_insert_self on public.lobby_members;
create policy members_insert_host on public.lobby_members for insert
  with check (public.is_lobby_host(lobby_id));

drop policy if exists members_update_self_or_host on public.lobby_members;
create policy members_update_self_or_host on public.lobby_members for update
  using (user_id = auth.uid() or public.is_lobby_host(lobby_id))
  -- A member may touch their own row but cannot grant themselves host status.
  with check (
    (user_id = auth.uid() and is_host = public.is_lobby_host(lobby_id))
    or public.is_lobby_host(lobby_id)
  );

drop policy if exists members_delete_self_or_host on public.lobby_members;
create policy members_delete_self_or_host on public.lobby_members for delete
  using (user_id = auth.uid() or public.is_lobby_host(lobby_id));

-- Chat
drop policy if exists chat_select_members on public.chat_messages;
create policy chat_select_members on public.chat_messages for select
  using (public.is_lobby_member(lobby_id));

drop policy if exists chat_insert_members on public.chat_messages;
create policy chat_insert_members on public.chat_messages for insert
  with check (user_id = auth.uid() and public.is_lobby_member(lobby_id));

drop policy if exists chat_delete_own_or_host on public.chat_messages;
create policy chat_delete_own_or_host on public.chat_messages for delete
  using (user_id = auth.uid() or public.is_lobby_host(lobby_id));

-- Careers: members may read; only the host may insert the initial snapshot.
-- Updates/deletes are intentionally not granted to browser roles; Edge
-- Functions use the service role to write authoritative state.
drop policy if exists careers_select_members on public.careers;
create policy careers_select_members on public.careers for select
  using (public.is_lobby_member(lobby_id));

drop policy if exists careers_insert_host on public.careers;
create policy careers_insert_host on public.careers for insert
  with check (public.is_lobby_host(lobby_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['lobbies', 'lobby_members', 'chat_messages', 'careers'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping: prune stale lobbies (optional; run on a schedule)
-- ---------------------------------------------------------------------------
create or replace function public.prune_stale_lobbies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.lobbies l
  where l.created_at < now() - interval '180 days'
    and not exists (
      select 1 from public.lobby_members m
      where m.lobby_id = l.id and m.last_seen > now() - interval '120 days'
    );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- =====================================================================
-- StudyHub / ConfessHub  -  Supabase schema
-- Run this whole file once: Supabase dashboard > SQL Editor > New query.
-- Safe to re-run.
-- =====================================================================

-- 1) Profiles (one row per signed-up user) ----------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text not null,
  role       text not null default 'student',
  avatar     text,
  bio        text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists bio text not null default '';
-- Roles: student (default sign-up) < admin (created by the developer) < developer (full control)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student','admin','developer'));

-- 2) Developer settings (no RLS policy = browsers can never read it) --
create table if not exists public.admin_settings (
  id              int primary key default 1 check (id = 1),
  developer_email text
);
alter table public.admin_settings enable row level security;
alter table public.admin_settings add column if not exists developer_email text;
alter table public.admin_settings drop column if exists admin_code;   -- old sign-up admin code is gone
-- >>> The account that signs up with this email becomes the DEVELOPER.
-- >>> Change it to your own email BEFORE running, then sign up with it right away.
insert into public.admin_settings (id, developer_email)
values (1, 'shopeehack40@gmail.com')
on conflict (id) do nothing;

-- 3) Posts and login log ---------------------------------------------
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  body        text not null default '',
  media_url   text,
  media_type  text check (media_type in ('image','video')),
  created_at  timestamptz not null default now(),
  constraint posts_has_content check (length(trim(body)) > 0 or media_url is not null)
);
create index if not exists posts_created_idx on public.posts (created_at desc);

create table if not exists public.login_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists login_events_created_idx on public.login_events (created_at desc);

-- 4) Helper functions + triggers -------------------------------------
-- Admins AND the developer count as staff (moderation, user list, login log).
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','developer'));
$$;

create or replace function public.is_developer()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'developer');
$$;

-- New auth user -> profile. Everyone starts as a student. Only the email saved in
-- admin_settings.developer_email becomes the developer. Admins are made by the developer.
-- Nothing the browser sends can choose a role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dev_email text;
  new_role  text := 'student';
begin
  select developer_email into dev_email from public.admin_settings where id = 1;
  if dev_email is not null and lower(new.email) = lower(dev_email) then
    new_role := 'developer';
  end if;
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email,
    new_role
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp author / login name from the profile so clients can't fake them.
create or replace function public.stamp_post_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select name into new.author_name from public.profiles where id = new.user_id;
  return new;
end $$;
drop trigger if exists posts_stamp_author on public.posts;
create trigger posts_stamp_author before insert on public.posts
  for each row execute function public.stamp_post_author();

create or replace function public.stamp_login_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select email, name into new.email, new.name from public.profiles where id = new.user_id;
  return new;
end $$;
drop trigger if exists login_events_stamp on public.login_events;
create trigger login_events_stamp before insert on public.login_events
  for each row execute function public.stamp_login_event();

-- 5) Row Level Security ----------------------------------------------
alter table public.profiles     enable row level security;
alter table public.posts        enable row level security;
alter table public.login_events enable row level security;

-- profiles: you see yourself, admins/developer see everyone
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Users may only change name/avatar, never their own role.
revoke update on public.profiles from anon, authenticated;
grant  update (name, avatar, bio) on public.profiles to authenticated;

-- posts: everyone signed in reads; you write your own; owner or admin deletes
drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts for select to authenticated using (true);
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "posts delete own or admin" on public.posts;
create policy "posts delete own or admin" on public.posts for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- login_events: you record your own login, only admins can read them
drop policy if exists "login insert own" on public.login_events;
create policy "login insert own" on public.login_events for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "login read admin" on public.login_events;
create policy "login read admin" on public.login_events for select to authenticated
  using (public.is_admin());

-- 5b) Developer-only controls ----------------------------------------
-- Change an account between student and admin. The developer role can never be
-- granted or removed from here.
create or replace function public.set_user_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not public.is_developer() then raise exception 'Developer access required'; end if;
  if new_role not in ('student','admin') then raise exception 'Role must be student or admin'; end if;
  select role into cur from public.profiles where id = target;
  if cur is null then raise exception 'User not found'; end if;
  if cur = 'developer' then raise exception 'The developer account cannot be changed'; end if;
  update public.profiles set role = new_role where id = target;
end $$;

-- Permanently delete a student/admin account (and their posts / login history).
create or replace function public.delete_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare cur text;
begin
  if not public.is_developer() then raise exception 'Developer access required'; end if;
  select role into cur from public.profiles where id = target;
  if cur is null then raise exception 'User not found'; end if;
  if cur = 'developer' then raise exception 'The developer account cannot be deleted'; end if;
  delete from auth.users where id = target;
end $$;

revoke all on function public.set_user_role(uuid, text) from public, anon;
revoke all on function public.delete_user(uuid)         from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.delete_user(uuid)         to authenticated;

-- If the developer email already has an account, promote it now.
update public.profiles set role = 'developer'
where lower(email) = (select lower(developer_email) from public.admin_settings where id = 1);

-- 6) Storage bucket for photos / videos ------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800,
        array['image/jpeg','image/png','image/gif','image/webp',
              'video/mp4','video/webm','video/quicktime'])
on conflict (id) do nothing;

drop policy if exists "post media upload" on storage.objects;
create policy "post media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "post media delete" on storage.objects;
create policy "post media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- 7) Realtime (live feed + "new login" alerts for admins) ------------
do $$ begin
  begin alter publication supabase_realtime add table public.posts;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.login_events; exception when duplicate_object then null; end;
end $$;


-- 8) Profiles: bio, public view (username + pfp + bio only), avatars ---
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 300) not valid;
alter table public.profiles drop constraint if exists profiles_name_len;
alter table public.profiles add constraint profiles_name_len check (char_length(trim(name)) between 1 and 40) not valid;
alter table public.profiles drop constraint if exists profiles_avatar_https;
alter table public.profiles add constraint profiles_avatar_https check (avatar is null or avatar ~ '^https://') not valid;

-- What OTHER users may see: username, pfp, bio. Never the email or role.
create or replace view public.public_profiles as
  select id, name, avatar, bio, created_at from public.profiles;
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

-- Keep old posts in sync when someone changes their username.
create or replace function public.sync_author_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    update public.posts set author_name = new.name where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_sync_name on public.profiles;
create trigger profiles_sync_name after update of name on public.profiles
  for each row execute function public.sync_author_name();

-- Profile pictures bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/gif','image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatar upload" on storage.objects;
create policy "avatar upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar delete" on storage.objects;
create policy "avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 9) Friends ----------------------------------------------------------
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
-- one row per pair, whichever direction it was sent
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.friendships enable row level security;

drop policy if exists "friends read own" on public.friendships;
create policy "friends read own" on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
drop policy if exists "friends send" on public.friendships;
create policy "friends send" on public.friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');
-- only the person who RECEIVED the request can accept it
drop policy if exists "friends accept" on public.friendships;
create policy "friends accept" on public.friendships for update to authenticated
  using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
revoke update on public.friendships from anon, authenticated;
grant  update (status) on public.friendships to authenticated;
-- reject / cancel / unfriend = delete (either side)
drop policy if exists "friends delete" on public.friendships;
create policy "friends delete" on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

do $$ begin
  begin alter publication supabase_realtime add table public.friendships; exception when duplicate_object then null; end;
end $$;


-- =====================================================================
-- 10) Profile safety net  (fixes "This user couldn't be found")
-- =====================================================================
-- Accounts created before the signup trigger existed (or whose trigger failed) have no
-- profile row, so nobody could open their profile. Create the missing rows once...
insert into public.profiles (id, name, email, role)
select u.id,
       coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
       u.email,
       'student'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ...and let the app repair its own row at login if it is ever missing again.
create or replace function public.ensure_my_profile()
returns void language plpgsql security definer set search_path = public, auth as $$
declare u auth.users%rowtype; dev text;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null or exists (select 1 from public.profiles where id = u.id) then return; end if;
  select developer_email into dev from public.admin_settings where id = 1;
  insert into public.profiles (id, name, email, role)
  values (u.id,
          coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
          u.email,
          case when dev is not null and lower(u.email) = lower(dev) then 'developer' else 'student' end);
end $$;
revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;


-- =====================================================================
-- 11) Notifications  (role changes, community requests / approvals, added to a community)
-- =====================================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,           -- role | community_request | community_approved | community_rejected | community_added
  title      text not null,
  body       text not null default '',
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "notif read own" on public.notifications;
create policy "notif read own" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "notif update own" on public.notifications;
create policy "notif update own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notif delete own" on public.notifications;
create policy "notif delete own" on public.notifications for delete to authenticated using (user_id = auth.uid());
-- Nobody can insert from the browser: rows only come from the triggers / functions below.
revoke update on public.notifications from anon, authenticated;
grant  update (read) on public.notifications to authenticated;

-- When the developer makes someone an admin (or removes it), tell that person.
create or replace function public.notify_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if new.role = 'admin' then
      insert into public.notifications (user_id, kind, title, body, link)
      values (new.id, 'role', 'You are now an Admin',
              'The developer promoted your account to Admin. You can now open the Admin panel and review community requests.', '#admin');
    elsif old.role = 'admin' and new.role = 'student' then
      insert into public.notifications (user_id, kind, title, body, link)
      values (new.id, 'role', 'Your Admin access was removed',
              'The developer changed your account back to Student.', '#dashboard');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_notify_role on public.profiles;
create trigger profiles_notify_role after update of role on public.profiles
  for each row execute function public.notify_role_change();


-- =====================================================================
-- 12) Communities  (created only after an admin / the developer approves a request)
-- =====================================================================
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 3 and 40),
  description text not null default '' check (char_length(description) <= 300),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.community_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 3 and 40),
  description  text not null default '' check (char_length(description) <= 300),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  community_id uuid references public.communities(id) on delete set null,
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists community_requests_status_idx on public.community_requests (status, created_at desc);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  added_by     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.communities        enable row level security;
alter table public.community_requests enable row level security;
alter table public.community_members  enable row level security;

-- helpers (security definer so the policies below don't recurse)
create or replace function public.is_community_member(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.community_members where community_id = cid and user_id = auth.uid());
$$;
create or replace function public.community_owner(cid uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select owner_id from public.communities where id = cid;
$$;

-- communities: members (and staff) can see them; only the owner / staff can delete. Creation = approval function only.
drop policy if exists "communities read" on public.communities;
create policy "communities read" on public.communities for select to authenticated
  using (public.is_community_member(id) or public.is_admin());
drop policy if exists "communities delete" on public.communities;
create policy "communities delete" on public.communities for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());
revoke insert, update on public.communities from anon, authenticated;

-- members: visible to members; leave yourself (not the owner); owner / staff can remove people. Adding = function below.
drop policy if exists "members read" on public.community_members;
create policy "members read" on public.community_members for select to authenticated
  using (public.is_community_member(community_id) or public.is_admin());
drop policy if exists "members delete" on public.community_members;
create policy "members delete" on public.community_members for delete to authenticated
  using (
    (user_id = auth.uid() and user_id <> public.community_owner(community_id))
    or (public.community_owner(community_id) = auth.uid() and user_id <> auth.uid())
    or public.is_admin()
  );
revoke insert, update on public.community_members from anon, authenticated;

-- requests: anyone can ask; you see your own; staff see all. Review = function below.
drop policy if exists "creq read" on public.community_requests;
create policy "creq read" on public.community_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_admin());
drop policy if exists "creq insert" on public.community_requests;
create policy "creq insert" on public.community_requests for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending' and community_id is null and reviewed_by is null);
drop policy if exists "creq cancel" on public.community_requests;
create policy "creq cancel" on public.community_requests for delete to authenticated
  using (requester_id = auth.uid() and status = 'pending');
revoke update on public.community_requests from anon, authenticated;

-- max 3 pending requests per person; tell every admin + the developer about a new one
create or replace function public.on_community_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if (select count(*) from public.community_requests where requester_id = new.requester_id and status = 'pending') >= 3 then
    raise exception 'You already have 3 requests waiting for review.';
  end if;
  return new;
end $$;
drop trigger if exists creq_limit on public.community_requests;
create trigger creq_limit before insert on public.community_requests
  for each row execute function public.on_community_request();

create or replace function public.notify_community_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from public.profiles where id = new.requester_id;
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, 'community_request', 'New community request',
         coalesce(who, 'Someone') || ' asked to create "' || new.name || '".', '#communities'
  from public.profiles p
  where p.role in ('admin','developer') and p.id <> new.requester_id;
  return new;
end $$;
drop trigger if exists creq_notify on public.community_requests;
create trigger creq_notify after insert on public.community_requests
  for each row execute function public.notify_community_request();

-- Admin / developer approves or rejects a request.
-- Works for any pending request (including ones the reviewer filed themselves) and returns the new community id.
drop function if exists public.review_community_request(uuid, boolean);
create or replace function public.review_community_request(req uuid, approve boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.community_requests%rowtype; cid uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin or developer access required'; end if;
  select * into r from public.community_requests where id = req for update;
  if not found then raise exception 'Request not found (it may have been cancelled)'; end if;
  if r.status <> 'pending' then raise exception 'This request was already reviewed'; end if;

  if approve then
    insert into public.communities (name, description, owner_id)
    values (trim(r.name), r.description, r.requester_id) returning id into cid;
    insert into public.community_members (community_id, user_id, added_by)
    values (cid, r.requester_id, r.requester_id) on conflict do nothing;
    update public.community_requests
      set status = 'approved', community_id = cid, reviewed_by = auth.uid(), reviewed_at = now() where id = req;
    insert into public.notifications (user_id, kind, title, body, link)
    values (r.requester_id, 'community_approved', 'Community approved',
            '"' || r.name || '" was approved. You can now add your friends to it.', '#community-' || cid);
  else
    update public.community_requests
      set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now() where id = req;
    insert into public.notifications (user_id, kind, title, body, link)
    values (r.requester_id, 'community_rejected', 'Community request declined',
            'Your request for "' || r.name || '" was not approved.', '#communities');
  end if;
  return cid;
end $$;

-- Any member can add one of THEIR OWN friends, just like a group chat.
create or replace function public.add_community_member(cid uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cname text; who text;
begin
  if not public.is_community_member(cid) then raise exception 'Only members can add people'; end if;
  if not exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = auth.uid() and addressee_id = target) or (requester_id = target and addressee_id = auth.uid()))
  ) then raise exception 'You can only add your friends'; end if;

  insert into public.community_members (community_id, user_id, added_by)
  values (cid, target, auth.uid()) on conflict do nothing;
  if found then
    select name into cname from public.communities where id = cid;
    select name into who from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, title, body, link)
    values (target, 'community_added', 'Added to a community',
            coalesce(who, 'A friend') || ' added you to "' || cname || '".', '#community-' || cid);
  end if;
end $$;

revoke all on function public.review_community_request(uuid, boolean) from public, anon;
revoke all on function public.add_community_member(uuid, uuid)        from public, anon;
grant execute on function public.review_community_request(uuid, boolean) to authenticated;
grant execute on function public.add_community_member(uuid, uuid)        to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.notifications;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.communities;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.community_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.community_members;  exception when duplicate_object then null; end;
end $$;


-- =====================================================================
-- 13) Post reactions + comments
-- =====================================================================
create table if not exists public.post_reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('like','love','haha','wow','sad','fire')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)            -- one reaction per person per post; change it by updating
);

create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_reactions enable row level security;
alter table public.post_comments  enable row level security;

drop policy if exists "reactions read" on public.post_reactions;
create policy "reactions read" on public.post_reactions for select to authenticated using (true);
drop policy if exists "reactions insert own" on public.post_reactions;
create policy "reactions insert own" on public.post_reactions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "reactions update own" on public.post_reactions;
create policy "reactions update own" on public.post_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "reactions delete own" on public.post_reactions;
create policy "reactions delete own" on public.post_reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists "comments read" on public.post_comments;
create policy "comments read" on public.post_comments for select to authenticated using (true);
drop policy if exists "comments insert own" on public.post_comments;
create policy "comments insert own" on public.post_comments for insert to authenticated with check (user_id = auth.uid());
-- delete: your own comment, the post's author, or staff
drop policy if exists "comments delete" on public.post_comments;
create policy "comments delete" on public.post_comments for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );

-- Tell the post's author about a new reaction / comment (not for their own).
create or replace function public.notify_post_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; who text;
begin
  select user_id into owner from public.posts where id = new.post_id;
  if owner is null or owner = new.user_id then return new; end if;
  select name into who from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, kind, title, body, link)
  values (owner, 'post_reaction', 'New reaction on your post',
          coalesce(who, 'Someone') || ' reacted to your post.', '#dashboard');
  return new;
end $$;
drop trigger if exists post_reactions_notify on public.post_reactions;
create trigger post_reactions_notify after insert on public.post_reactions
  for each row execute function public.notify_post_reaction();

create or replace function public.notify_post_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; who text;
begin
  select user_id into owner from public.posts where id = new.post_id;
  if owner is null or owner = new.user_id then return new; end if;
  select name into who from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, kind, title, body, link)
  values (owner, 'post_comment', 'New comment on your post',
          coalesce(who, 'Someone') || ': ' || left(new.body, 80), '#dashboard');
  return new;
end $$;
drop trigger if exists post_comments_notify on public.post_comments;
create trigger post_comments_notify after insert on public.post_comments
  for each row execute function public.notify_post_comment();

do $$ begin
  begin alter publication supabase_realtime add table public.post_reactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.post_comments;  exception when duplicate_object then null; end;
end $$;


-- =====================================================================
-- 14) Announcements  (posted by admin / developer, shown to everyone as a pop-up ONCE)
-- =====================================================================
-- * Only admins and the developer can post. Everyone signed in can read.
-- * The pop-up is shown for 24 hours after posting, and never again once a person has seen it
--   (announcement_seen is stored per user, so it also works across devices).
-- * After 24 hours the announcement stops popping up but stays on the Announcements page.
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  author_role text not null default 'admin',
  title       text not null,
  body        text not null default '',
  created_at  timestamptz not null default now(),
  constraint announcements_title_len check (length(trim(title)) between 1 and 120),
  constraint announcements_body_len  check (length(body) <= 2000)
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);
alter table public.announcements enable row level security;

create table if not exists public.announcement_seen (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  seen_at         timestamptz not null default now(),
  primary key (user_id, announcement_id)
);
alter table public.announcement_seen enable row level security;

drop policy if exists "ann read" on public.announcements;
create policy "ann read" on public.announcements for select to authenticated using (true);
drop policy if exists "ann insert staff" on public.announcements;
create policy "ann insert staff" on public.announcements for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid());
-- delete: the author, or the developer
drop policy if exists "ann delete" on public.announcements;
create policy "ann delete" on public.announcements for delete to authenticated
  using (author_id = auth.uid() or public.is_developer());

drop policy if exists "ann seen read own" on public.announcement_seen;
create policy "ann seen read own" on public.announcement_seen for select to authenticated using (user_id = auth.uid());
drop policy if exists "ann seen insert own" on public.announcement_seen;
create policy "ann seen insert own" on public.announcement_seen for insert to authenticated with check (user_id = auth.uid());

-- Stamp the author's name + role from the profile so clients can't fake them,
-- and count the author as having "seen" their own announcement.
create or replace function public.stamp_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select name, role into new.author_name, new.author_role from public.profiles where id = new.author_id;
  return new;
end $$;
drop trigger if exists announcements_stamp on public.announcements;
create trigger announcements_stamp before insert on public.announcements
  for each row execute function public.stamp_announcement();

create or replace function public.announcement_author_seen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.announcement_seen (user_id, announcement_id) values (new.author_id, new.id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists announcements_author_seen on public.announcements;
create trigger announcements_author_seen after insert on public.announcements
  for each row execute function public.announcement_author_seen();

-- When an admin or the developer logs in, tell every student (bell + toast).
-- At most once per hour per staff member so repeated logins don't spam people.
create or replace function public.notify_staff_login()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record; link_ text;
begin
  select id, name, role into p from public.profiles where id = new.user_id;
  if p.id is null or p.role not in ('admin','developer') then return new; end if;
  link_ := '#user-' || p.id::text;
  if exists (select 1 from public.notifications
             where kind = 'staff_login' and link = link_ and created_at > now() - interval '1 hour') then
    return new;
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  select s.id, 'staff_login',
         case when p.role = 'developer' then 'The Developer is online' else 'An Admin is online' end,
         coalesce(nullif(p.name, ''), 'Staff') || ' just logged in.',
         link_
  from public.profiles s
  where s.role = 'student' and s.id <> p.id;
  return new;
end $$;
drop trigger if exists login_events_notify_staff on public.login_events;
create trigger login_events_notify_staff after insert on public.login_events
  for each row execute function public.notify_staff_login();

do $$ begin
  begin alter publication supabase_realtime add table public.announcements; exception when duplicate_object then null; end;
end $$;

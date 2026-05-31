-- PMS 자체 계정 인증 (Supabase Auth/이메일 인증 미사용)
-- 이메일/비밀번호를 직접 DB(pms_accounts)에 저장하고, RPC 함수로 가입·로그인을 처리한다.
-- 비밀번호는 pgcrypto(bcrypt)로 해시해서 저장한다(평문 저장 금지).
--
-- 보안 메모:
--  - pms_accounts 는 RLS로 직접 접근을 전면 차단하고, SECURITY DEFINER 함수로만 접근한다.
--  - 따라서 anon 키로도 비밀번호 해시를 읽거나 임의로 행을 만들 수 없다.
--  - 단, Supabase Auth 세션이 없으므로 pms_projects 는 anon 접근을 다시 허용한다(아래 4).

-- ─────────────────────────────────────────────────────────────
-- 0) 해시용 확장
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1) 계정 테이블
create table if not exists public.pms_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text not null default '',
  role text not null default 'requester'
    check (role in ('requester','sales','marketing','pm','cem','developer','qa','security','infra','patent','admin')),
  created_at timestamptz not null default now()
);

-- 직접 접근 전면 차단(함수만 접근 가능)
alter table public.pms_accounts enable row level security;
revoke all on public.pms_accounts from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) 가입: 이메일 중복이면 에러, 정상이면 계정 정보(JSON, 해시 제외) 반환
create or replace function public.pms_register(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(nullif(trim(p_role), ''), 'requester');
  v_row public.pms_accounts;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'invalid_email';
  end if;
  if length(p_password) < 8 then
    raise exception 'weak_password';
  end if;
  if exists (select 1 from public.pms_accounts where email = v_email) then
    raise exception 'email_taken';
  end if;

  insert into public.pms_accounts (email, password_hash, full_name, role)
  values (v_email, crypt(p_password, gen_salt('bf')), coalesce(trim(p_full_name), ''), v_role)
  returning * into v_row;

  return json_build_object(
    'id', v_row.id,
    'email', v_row.email,
    'full_name', v_row.full_name,
    'role', v_row.role
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3) 로그인: 이메일+비밀번호가 맞으면 계정 정보(JSON) 반환, 아니면 null
create or replace function public.pms_authenticate(
  p_email text,
  p_password text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.pms_accounts;
begin
  select * into v_row from public.pms_accounts where email = v_email;
  if v_row.id is null then
    return null;
  end if;
  if v_row.password_hash <> crypt(p_password, v_row.password_hash) then
    return null;
  end if;
  return json_build_object(
    'id', v_row.id,
    'email', v_row.email,
    'full_name', v_row.full_name,
    'role', v_row.role
  );
end;
$$;

-- anon/authenticated 모두 RPC 호출 허용
grant execute on function public.pms_register(text, text, text, text) to anon, authenticated;
grant execute on function public.pms_authenticate(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4) pms_projects: Supabase Auth 세션을 안 쓰므로 anon 접근을 다시 허용
--    (이전 인증 마이그레이션에서 authenticated 전용으로 제한했던 정책을 대체)
drop policy if exists "pms_projects read (authenticated)" on public.pms_projects;
drop policy if exists "pms_projects insert (authenticated)" on public.pms_projects;
drop policy if exists "pms_projects update (authenticated)" on public.pms_projects;
drop policy if exists "pms_projects delete (admin only)" on public.pms_projects;

create policy "pms_projects read (app)"
  on public.pms_projects for select
  to anon, authenticated
  using (true);

create policy "pms_projects insert (app)"
  on public.pms_projects for insert
  to anon, authenticated
  with check (true);

create policy "pms_projects update (app)"
  on public.pms_projects for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "pms_projects delete (app)"
  on public.pms_projects for delete
  to anon, authenticated
  using (true);

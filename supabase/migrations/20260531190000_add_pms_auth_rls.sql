-- PMS 인증 + 권한(RLS) 도입
-- 1) 사용자 프로필 테이블(pms_profiles) — auth.users 와 1:1, 앱 역할(role) 보관
-- 2) 가입 시 프로필 자동 생성 트리거(handle_new_pms_user)
-- 3) 현재 로그인 사용자의 앱 역할을 조회하는 헬퍼(pms_current_role)
-- 4) pms_projects 의 익명(anon) 접근을 제거하고 로그인 사용자로 제한, 삭제는 관리자만
--
-- 주의: 적용 후에는 로그인하지 않은(anon) 접근이 모두 차단됩니다.
--       데모 시드(scripts/seed.ts)는 anon 키를 쓰므로, 시드는 이 마이그레이션 적용 전에
--       끝내두었거나 이후에는 service_role 키로만 가능합니다.

-- ─────────────────────────────────────────────────────────────
-- 1) 프로필 테이블
-- role 은 앱 역할 문자열(requester/pm/cem/developer/qa/security/infra/patent/admin)을 그대로 저장
create table if not exists public.pms_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'requester'
    check (role in ('requester','sales','marketing','pm','cem','developer','qa','security','infra','patent','admin')),
  created_at timestamptz not null default now()
);

alter table public.pms_profiles enable row level security;

-- 로그인 사용자는 모든 프로필을 읽을 수 있음(이력/담당자 이름 표시용)
drop policy if exists "pms_profiles read (authenticated)" on public.pms_profiles;
create policy "pms_profiles read (authenticated)"
  on public.pms_profiles for select
  to authenticated
  using (true);

-- 본인 프로필의 표시 이름만 수정 가능(역할은 변경 불가 — 계정당 역할 고정)
-- 역할 변경은 관리자가 DB/대시보드에서 직접 처리
drop policy if exists "pms_profiles update own name" on public.pms_profiles;
create policy "pms_profiles update own name"
  on public.pms_profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.pms_profiles p where p.id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 2) 가입 시 프로필 자동 생성
-- 회원가입 시 user_metadata 의 full_name / role 을 프로필로 복사
create or replace function public.handle_new_pms_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pms_profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'role', ''),
      'requester'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_pms on auth.users;
create trigger on_auth_user_created_pms
  after insert on auth.users
  for each row execute function public.handle_new_pms_user();

-- ─────────────────────────────────────────────────────────────
-- 3) 현재 로그인 사용자의 앱 역할 조회 헬퍼
create or replace function public.pms_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.pms_profiles where id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────
-- 4) pms_projects 접근을 로그인 사용자로 제한
-- 기존 anon 포함 정책 제거
drop policy if exists "Allow read access for app users" on public.pms_projects;
drop policy if exists "Allow writes for app users" on public.pms_projects;

-- 로그인 사용자만 조회
create policy "pms_projects read (authenticated)"
  on public.pms_projects for select
  to authenticated
  using (true);

-- 로그인 사용자만 생성/수정 (워크플로 권한은 앱에서 단계별로 강제)
create policy "pms_projects insert (authenticated)"
  on public.pms_projects for insert
  to authenticated
  with check (true);

create policy "pms_projects update (authenticated)"
  on public.pms_projects for update
  to authenticated
  using (true)
  with check (true);

-- 삭제는 관리자만
create policy "pms_projects delete (admin only)"
  on public.pms_projects for delete
  to authenticated
  using (public.pms_current_role() = 'admin');

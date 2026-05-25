create type public.pms_project_status as enum (
  'request',
  'dept_review',
  'srs',
  'sds',
  'schedule',
  'development',
  'qc_security',
  'uat',
  'completion',
  'published',
  'rejected'
);

create type public.pms_project_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.pms_project_role as enum ('requester', 'reviewer', 'developer', 'qa', 'admin');

create table public.pms_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  service_name text not null,
  service_area text not null,
  requester text not null,
  owner_team text not null,
  priority public.pms_project_priority not null default 'normal',
  status public.pms_project_status not null default 'request',
  summary text not null,
  current_problem text not null,
  desired_outcome text not null,
  success_metric text not null,
  affected_users text not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  risk text not null default '',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  next_action text not null default '요청 내용 검토',
  assignee_role public.pms_project_role not null default 'requester',
  tasks jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb
);

alter table public.pms_projects enable row level security;

create policy "Allow read access for app users"
on public.pms_projects for select
to anon, authenticated
using (true);

create policy "Allow writes for app users"
on public.pms_projects for all
to anon, authenticated
using (true)
with check (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pms_projects_set_updated_at
before update on public.pms_projects
for each row
execute function public.set_updated_at();

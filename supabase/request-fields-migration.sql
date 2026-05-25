alter table public.pms_projects
  add column if not exists service_name text not null default '',
  add column if not exists service_area text not null default '',
  add column if not exists current_problem text not null default '',
  add column if not exists desired_outcome text not null default '',
  add column if not exists success_metric text not null default '',
  add column if not exists affected_users text not null default '';

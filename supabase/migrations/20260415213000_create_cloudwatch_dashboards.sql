create extension if not exists pgcrypto;
create table if not exists public.monitor_cloudwatch_dashboards (
  id uuid primary key default gen_random_uuid(),
  dashboard_name text not null unique,
  dashboard_arn text,
  last_modified timestamptz,
  size_hint bigint,
  dashboard_body text not null,
  source_region text not null,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
drop trigger if exists set_monitor_cloudwatch_dashboards_updated_at on public.monitor_cloudwatch_dashboards;
create trigger set_monitor_cloudwatch_dashboards_updated_at
before update on public.monitor_cloudwatch_dashboards
for each row
execute procedure public.set_updated_at();

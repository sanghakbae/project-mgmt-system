create table if not exists public.resume_visit_counters (
  owner_id text primary key references public.resume_workspaces(owner_id) on delete cascade,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.resume_visit_counters enable row level security;
create policy "public read resume visit counters"
on public.resume_visit_counters
for select
using (true);
create or replace function public.increment_resume_visit_count(p_owner_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count bigint;
begin
  insert into public.resume_visit_counters (owner_id, count, updated_at)
  values (p_owner_id, 1, now())
  on conflict (owner_id)
  do update set
    count = public.resume_visit_counters.count + 1,
    updated_at = now()
  returning count into next_count;

  return next_count;
end;
$$;
grant execute on function public.increment_resume_visit_count(text) to anon, authenticated;

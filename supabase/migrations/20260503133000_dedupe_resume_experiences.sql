update public.resume_workspaces
set experiences = coalesce(
  (
    select jsonb_agg(item order by first_order)
    from (
      select distinct on (
        trim(coalesce(item->>'organization', '')),
        trim(coalesce(item->>'title', '')),
        trim(coalesce(item->>'period', '')),
        regexp_replace(trim(coalesce(item->>'description', '')), '\s+', ' ', 'g')
      )
        item,
        ordinality as first_order
      from jsonb_array_elements(experiences) with ordinality as source(item, ordinality)
      order by
        trim(coalesce(item->>'organization', '')),
        trim(coalesce(item->>'title', '')),
        trim(coalesce(item->>'period', '')),
        regexp_replace(trim(coalesce(item->>'description', '')), '\s+', ' ', 'g'),
        ordinality
    ) deduped
  ),
  '[]'::jsonb
),
updated_at = now()
where jsonb_typeof(experiences) = 'array';

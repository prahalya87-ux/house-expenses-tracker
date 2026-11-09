create table public.waste_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null,
  fingerprint text not null,
  finding_type text not null check (finding_type in (
    'repeat_purchase',
    'delivery_frequency',
    'subscription_review',
    'non_essential_growth'
  )),
  title text not null,
  explanation text not null,
  category_id uuid,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  occurrences integer not null default 0 check (occurrences >= 0),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  potential_savings numeric(12, 2) check (potential_savings >= 0),
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array'),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint),
  foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete cascade
);

create index waste_findings_user_status_idx
  on public.waste_findings (user_id, status);

alter table public.waste_findings enable row level security;

create policy "Users can manage their waste findings"
  on public.waste_findings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.waste_findings to authenticated;

notify pgrst, 'reload schema';

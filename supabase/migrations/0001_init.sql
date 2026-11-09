create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('expense', 'income')),
  is_essential boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, kind),
  unique (user_id, name, kind)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null,
  kind text not null check (kind in ('expense', 'income')),
  amount numeric(12, 2) not null check (amount > 0),
  description text,
  merchant text,
  txn_date date not null,
  payment_method text,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id, kind)
    references public.categories (id, user_id, kind) on delete cascade
);
create index transactions_user_date_idx
  on public.transactions (user_id, txn_date desc);
create index transactions_user_category_date_idx
  on public.transactions (user_id, category_id, txn_date desc);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid,
  month date not null check (extract(day from month) = 1),
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete cascade
);
create unique index budgets_user_category_month_idx
  on public.budgets (user_id, category_id, month)
  where category_id is not null;
create unique index budgets_user_overall_month_idx
  on public.budgets (user_id, month)
  where category_id is null;

create table public.anomaly_detections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  run_id uuid not null,
  anomaly_score double precision,
  severity text not null check (severity in ('low', 'medium', 'high')),
  reason_type text not null,
  baseline_amount numeric(12, 2),
  difference_amount numeric(12, 2),
  reason text not null,
  detection_method text not null check (detection_method in ('isolation_forest', 'rule')),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'dismissed')),
  detected_at timestamptz not null default now(),
  unique (user_id, transaction_id, reason_type),
  foreign key (transaction_id, user_id)
    references public.transactions (id, user_id) on delete cascade
);
create index anomaly_detections_user_status_idx
  on public.anomaly_detections (user_id, status, detected_at desc);

create table public.spending_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  analysis_type text not null check (analysis_type in (
    'daily', 'weekly', 'monthly', 'clusters', 'habit_change', 'income_expense'
  )),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, analysis_type)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  insert into public.categories (user_id, name, kind, is_essential)
  values
    (new.id, 'Groceries', 'expense', true),
    (new.id, 'Housing', 'expense', true),
    (new.id, 'Utilities', 'expense', true),
    (new.id, 'Transport', 'expense', true),
    (new.id, 'Health', 'expense', true),
    (new.id, 'Food Delivery', 'expense', false),
    (new.id, 'Subscriptions', 'expense', false),
    (new.id, 'Entertainment', 'expense', false),
    (new.id, 'Shopping', 'expense', false),
    (new.id, 'Salary', 'income', false),
    (new.id, 'Other Income', 'income', false);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email)
select id, email
from auth.users
on conflict (id) do nothing;

insert into public.categories (user_id, name, kind, is_essential)
select users.id, defaults.name, defaults.kind, defaults.is_essential
from auth.users as users
cross join (values
  ('Groceries', 'expense', true),
  ('Housing', 'expense', true),
  ('Utilities', 'expense', true),
  ('Transport', 'expense', true),
  ('Health', 'expense', true),
  ('Food Delivery', 'expense', false),
  ('Subscriptions', 'expense', false),
  ('Entertainment', 'expense', false),
  ('Shopping', 'expense', false),
  ('Salary', 'income', false),
  ('Other Income', 'income', false)
) as defaults(name, kind, is_essential)
on conflict (user_id, name, kind) do nothing;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.anomaly_detections enable row level security;
alter table public.spending_analysis enable row level security;

create policy "Users can view their profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can update their profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can manage their categories"
  on public.categories for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage their transactions"
  on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage their budgets"
  on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage their anomaly detections"
  on public.anomaly_detections for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage their spending analysis"
  on public.spending_analysis for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on
  public.categories,
  public.transactions,
  public.budgets,
  public.anomaly_detections,
  public.spending_analysis
to authenticated;

notify pgrst, 'reload schema';

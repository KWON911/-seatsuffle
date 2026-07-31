-- 자리바꾸기 기능용 테이블과 RLS 정책 초안입니다.
-- Supabase SQL Editor에서 실행하기 전, 운영 데이터 백업과 기존 객체 존재 여부를 반드시 확인하세요.
begin;

create table public.seating_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  roster_id uuid not null,
  title text not null,
  plan_date date not null,
  layout_type text not null default 'single',
  layout_config jsonb not null,
  teacher_direction text not null default 'north',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seating_plans_title_not_blank check (btrim(title) <> ''),
  constraint seating_plans_layout_type_valid check (layout_type in ('single', 'pair', 'group')),
  constraint seating_plans_teacher_direction_valid check (teacher_direction in ('north', 'south', 'east', 'west')),
  constraint seating_plans_roster_user_id_fkey foreign key (roster_id, user_id)
    references public.class_rosters (id, user_id) on delete cascade
);

create table public.seating_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.seating_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  roster_id uuid not null,
  student_id uuid not null,
  student_name_snapshot text not null,
  seat_id text not null,
  row_index integer not null,
  column_index integer not null,
  pair_id text null,
  group_id text null,
  is_fixed boolean not null default false,
  assignment_source text not null default 'automatic',
  created_at timestamptz not null default now(),
  constraint seating_assignments_name_not_blank check (btrim(student_name_snapshot) <> ''),
  constraint seating_assignments_row_positive check (row_index > 0),
  constraint seating_assignments_column_positive check (column_index > 0),
  constraint seating_assignments_source_valid check (assignment_source in ('automatic', 'manual')),
  constraint seating_assignments_plan_student_unique unique (plan_id, student_id),
  constraint seating_assignments_plan_seat_unique unique (plan_id, seat_id),
  constraint seating_assignments_roster_user_id_fkey foreign key (roster_id, user_id)
    references public.class_rosters (id, user_id) on delete cascade
);

create table public.seating_constraints (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.seating_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  roster_id uuid not null,
  constraint_type text not null,
  student_id uuid null,
  related_student_id uuid null,
  constraint_config jsonb not null default '{}'::jsonb,
  priority smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seating_constraints_priority_range check (priority between 1 and 9),
  constraint seating_constraints_distinct_students check (student_id is null or related_student_id is null or student_id <> related_student_id),
  constraint seating_constraints_roster_user_id_fkey foreign key (roster_id, user_id)
    references public.class_rosters (id, user_id) on delete cascade
);

create index seating_plans_user_roster_date_idx on public.seating_plans (user_id, roster_id, plan_date desc);
create index seating_assignments_user_roster_student_idx on public.seating_assignments (user_id, roster_id, student_id);
create index seating_constraints_plan_idx on public.seating_constraints (plan_id);

create trigger seating_plans_set_updated_at before update on public.seating_plans for each row execute function public.set_shared_rosters_updated_at();
create trigger seating_constraints_set_updated_at before update on public.seating_constraints for each row execute function public.set_shared_rosters_updated_at();

revoke all on public.seating_plans, public.seating_assignments, public.seating_constraints from public, anon;
grant select, insert, update, delete on public.seating_plans, public.seating_assignments, public.seating_constraints to authenticated;
alter table public.seating_plans enable row level security;
alter table public.seating_assignments enable row level security;
alter table public.seating_constraints enable row level security;

create policy "Users can manage their own seating plans" on public.seating_plans for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and exists (select 1 from public.class_rosters where id = seating_plans.roster_id and user_id = (select auth.uid())));
create policy "Users can manage their own seating assignments" on public.seating_assignments for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and exists (select 1 from public.seating_plans where id = seating_assignments.plan_id and user_id = (select auth.uid()) and roster_id = seating_assignments.roster_id));
create policy "Users can manage their own seating constraints" on public.seating_constraints for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and exists (select 1 from public.seating_plans where id = seating_constraints.plan_id and user_id = (select auth.uid()) and roster_id = seating_constraints.roster_id));

commit;

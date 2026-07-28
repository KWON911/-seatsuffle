-- 공통 학급 명단 시스템 초안입니다. Supabase SQL Editor에서 실행하기 전 반드시 검토하세요.

begin;

-- 기존 객체를 덮어쓰지 않기 위한 사전 확인입니다. 하나라도 있으면 전체 작업을 중단합니다.
do $$
declare
  conflicting_objects text[] := array[]::text[];
begin
  if to_regclass('public.class_rosters') is not null then
    conflicting_objects := array_append(conflicting_objects, 'public.class_rosters 표');
  end if;

  if to_regclass('public.students') is not null then
    conflicting_objects := array_append(conflicting_objects, 'public.students 표');
  end if;

  if to_regprocedure('public.set_shared_rosters_updated_at()') is not null then
    conflicting_objects := array_append(conflicting_objects, 'public.set_shared_rosters_updated_at() 함수');
  end if;

  if to_regprocedure('public.set_default_roster(uuid)') is not null then
    conflicting_objects := array_append(conflicting_objects, 'public.set_default_roster(uuid) 함수');
  end if;

  if cardinality(conflicting_objects) > 0 then
    raise exception '공통 학급 명단 migration을 실행할 수 없습니다. 이미 존재하는 객체: %', array_to_string(conflicting_objects, ', ');
  end if;
end;
$$;

-- 1. 표 생성
create table public.class_rosters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  roster_name text not null,
  school_year smallint not null,
  grade smallint not null,
  class_name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_rosters_roster_name_not_blank check (btrim(roster_name) <> ''),
  constraint class_rosters_school_year_in_range check (school_year between 2000 and 2100),
  constraint class_rosters_grade_elementary_range check (grade between 1 and 6),
  constraint class_rosters_class_name_not_blank check (btrim(class_name) <> ''),
  constraint class_rosters_id_user_id_key unique (id, user_id)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  roster_id uuid not null,
  display_name text not null,
  gender_code text not null default 'unspecified',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_display_name_not_blank check (btrim(display_name) <> ''),
  constraint students_gender_code_valid check (gender_code in ('male', 'female', 'unspecified')),
  constraint students_sort_order_non_negative check (sort_order >= 0),
  constraint students_roster_user_id_fkey
    foreign key (roster_id, user_id)
    references public.class_rosters (id, user_id)
    on delete cascade
);

-- 2. 제약 조건과 인덱스
create index class_rosters_user_updated_at_idx
  on public.class_rosters (user_id, updated_at desc);

create unique index class_rosters_one_default_per_user_idx
  on public.class_rosters (user_id)
  where is_default;

create index students_roster_user_sort_order_idx
  on public.students (roster_id, user_id, sort_order, id);

create index students_user_id_idx
  on public.students (user_id);

-- 3. updated_at 자동 갱신 함수와 트리거
create function public.set_shared_rosters_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger class_rosters_set_shared_rosters_updated_at
before update on public.class_rosters
for each row
execute function public.set_shared_rosters_updated_at();

create trigger students_set_shared_rosters_updated_at
before update on public.students
for each row
execute function public.set_shared_rosters_updated_at();

-- 4. 기본 학급 변경 함수: 현재 로그인 사용자의 학급만 변경합니다.
create function public.set_default_roster(target_roster_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null then
    raise exception '로그인이 필요합니다.';
  end if;

  -- 같은 사용자가 동시에 기본 학급을 바꾸는 경우를 순서대로 처리합니다.
  perform 1
  from public.class_rosters
  where user_id = (select auth.uid())
  for update;

  if not exists (
    select 1
    from public.class_rosters
    where id = target_roster_id
      and user_id = (select auth.uid())
  ) then
    raise exception '선택한 학급을 찾을 수 없습니다.';
  end if;

  update public.class_rosters
  set is_default = false
  where user_id = (select auth.uid())
    and is_default;

  update public.class_rosters
  set is_default = true
  where id = target_roster_id
    and user_id = (select auth.uid());
end;
$$;

-- 5. 권한: 로그인한 사용자만 필요한 CRUD와 기본 학급 함수를 사용할 수 있습니다.
revoke all on table public.class_rosters, public.students from public;
revoke all on table public.class_rosters, public.students from anon;
grant select, insert, update, delete on table public.class_rosters, public.students to authenticated;

revoke all on function public.set_shared_rosters_updated_at() from public;
revoke all on function public.set_shared_rosters_updated_at() from anon;
revoke all on function public.set_default_roster(uuid) from public;
revoke all on function public.set_default_roster(uuid) from anon;
grant execute on function public.set_default_roster(uuid) to authenticated;

-- 6. RLS 활성화
alter table public.class_rosters enable row level security;
alter table public.students enable row level security;

-- 7. SELECT, INSERT, UPDATE, DELETE 정책
create policy "Users can view their own class rosters"
on public.class_rosters
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own class rosters"
on public.class_rosters
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own class rosters"
on public.class_rosters
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own class rosters"
on public.class_rosters
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view students in their own class rosters"
on public.students
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.class_rosters
    where class_rosters.id = students.roster_id
      and class_rosters.user_id = (select auth.uid())
  )
);

create policy "Users can add students to their own class rosters"
on public.students
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.class_rosters
    where class_rosters.id = students.roster_id
      and class_rosters.user_id = (select auth.uid())
  )
);

create policy "Users can update students in their own class rosters"
on public.students
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.class_rosters
    where class_rosters.id = students.roster_id
      and class_rosters.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.class_rosters
    where class_rosters.id = students.roster_id
      and class_rosters.user_id = (select auth.uid())
  )
);

create policy "Users can delete students in their own class rosters"
on public.students
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.class_rosters
    where class_rosters.id = students.roster_id
      and class_rosters.user_id = (select auth.uid())
  )
);

commit;

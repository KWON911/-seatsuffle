-- 공통 학급 명단 migration이 성공적으로 실행된 경우에만 사용하는 rollback 초안입니다.
-- migration보다 먼저 임의로 실행하면 안 되며, 저장된 학급과 학생 데이터도 함께 삭제됩니다.

begin;

-- 1. RLS 정책 삭제
drop policy if exists "Users can delete students in their own class rosters" on public.students;
drop policy if exists "Users can update students in their own class rosters" on public.students;
drop policy if exists "Users can add students to their own class rosters" on public.students;
drop policy if exists "Users can view students in their own class rosters" on public.students;
drop policy if exists "Users can delete their own class rosters" on public.class_rosters;
drop policy if exists "Users can update their own class rosters" on public.class_rosters;
drop policy if exists "Users can create their own class rosters" on public.class_rosters;
drop policy if exists "Users can view their own class rosters" on public.class_rosters;

-- 2. 트리거 삭제
drop trigger if exists students_set_shared_rosters_updated_at on public.students;
drop trigger if exists class_rosters_set_shared_rosters_updated_at on public.class_rosters;

-- 3. 기본 학급 변경 함수 삭제
drop function if exists public.set_default_roster(uuid);

-- 4. updated_at 함수 삭제
drop function if exists public.set_shared_rosters_updated_at();

-- 5. 학생 표 삭제
drop table if exists public.students;

-- 6. 학급 표 삭제
drop table if exists public.class_rosters;

commit;

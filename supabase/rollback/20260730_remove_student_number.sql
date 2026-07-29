-- 주의: 이 rollback을 운영 데이터에 실행하면 저장된 실제 학생 번호가 삭제됩니다.
-- 이번 기능에서 추가한 번호 관련 객체만 제거하며 students 또는 class_rosters 표는 삭제하지 않습니다.
begin;

drop index if exists public.students_user_roster_student_number_key;

alter table public.students
  drop constraint if exists students_student_number_positive;

alter table public.students
  drop column if exists student_number;

commit;

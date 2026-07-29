-- 실제 학급 학생 번호를 추가합니다. 기존 학생 데이터는 NULL로 그대로 유지합니다.
begin;

alter table public.students
  add column student_number integer null;

alter table public.students
  add constraint students_student_number_positive
  check (student_number is null or student_number > 0);

-- 번호가 입력된 학생만 같은 사용자·학급 안에서 중복을 막습니다.
-- NULL 번호는 기존 학생 호환성을 위해 여러 행에서 허용합니다.
create unique index students_user_roster_student_number_key
  on public.students (user_id, roster_id, student_number)
  where student_number is not null;

commit;

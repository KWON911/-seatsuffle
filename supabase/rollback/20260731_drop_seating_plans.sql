-- 자리바꾸기 기능만 되돌리는 rollback입니다.
-- 실행하면 저장된 자리표, 배정 결과, 분리·고정 조건이 삭제됩니다.
begin;

drop table if exists public.seating_constraints;
drop table if exists public.seating_assignments;
drop table if exists public.seating_plans;

commit;

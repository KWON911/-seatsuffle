(() => {
  const PLAN_COLUMNS = "id, roster_id, title, plan_date, layout_type, layout_config, teacher_direction, created_at, updated_at";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function fail(message) { throw new Error(message); }
  function requireClient() {
    if (!window.kwonClassSupabase?.auth || !window.kwonClassSupabase?.from) fail("자리표 저장 기능을 준비하지 못했습니다.");
    return window.kwonClassSupabase;
  }
  function uuid(value, label) {
    const id = String(value || "").trim();
    if (!UUID_PATTERN.test(id)) fail(`${label} 형식이 올바르지 않습니다.`);
    return id;
  }
  function text(value, label) {
    const result = String(value || "").trim();
    if (!result) fail(`${label}을(를) 입력해 주세요.`);
    return result;
  }
  function safeError(error, fallback) {
    const source = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
    if (source.includes("row-level") || source.includes("permission")) return "이 작업을 수행할 권한이 없습니다.";
    if (source.includes("foreign key")) return "연결된 학급 또는 학생 정보를 확인할 수 없습니다.";
    if (source.includes("fetch") || source.includes("network")) return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
    return fallback;
  }
  async function currentUser() {
    const client = requireClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.id) fail(error ? safeError(error, "로그인 상태를 확인하지 못했습니다.") : "로그인이 필요합니다.");
    return { client, userId: data.user.id };
  }
  async function ownedRoster(client, userId, rosterId) {
    const id = uuid(rosterId, "학급 ID");
    const { data, error } = await client.from("class_rosters").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error || !data) fail(error ? safeError(error, "학급을 확인하지 못했습니다.") : "학급을 찾을 수 없거나 접근할 수 없습니다.");
    return id;
  }
  function normalizePlan(input) {
    if (!input || typeof input !== "object") fail("저장할 자리표 정보가 없습니다.");
    const planDate = String(input.planDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) fail("자리표 날짜를 선택해 주세요.");
    if (input.layoutType !== "single") fail("현재는 1인형 자리표만 저장할 수 있습니다.");
    if (!input.layoutConfig || typeof input.layoutConfig !== "object") fail("좌석 설정을 확인할 수 없습니다.");
    if (!Array.isArray(input.assignments)) fail("자리 배치 결과를 확인할 수 없습니다.");
    return { title: text(input.title, "자리표 제목"), planDate, layoutConfig: input.layoutConfig, assignments: input.assignments, constraints: Array.isArray(input.constraints) ? input.constraints : [] };
  }
  function assignmentRows(planId, userId, rosterId, assignments) {
    const students = new Set(); const seats = new Set();
    return assignments.map((assignment) => {
      const studentId = uuid(assignment.studentId, "학생 ID");
      const seatId = text(assignment.seatId, "좌석 ID");
      if (students.has(studentId) || seats.has(seatId)) fail("학생 또는 좌석이 중복 배정되어 저장할 수 없습니다.");
      students.add(studentId); seats.add(seatId);
      return { plan_id: planId, user_id: userId, roster_id: rosterId, student_id: studentId, student_name_snapshot: text(assignment.studentName, "학생 이름"), seat_id: seatId, row_index: Number(assignment.row), column_index: Number(assignment.column), pair_id: assignment.pairId || null, group_id: assignment.groupId || null, is_fixed: assignment.isFixed === true, assignment_source: assignment.source === "manual" ? "manual" : "automatic" };
    });
  }
  function constraintRows(planId, userId, rosterId, constraints) {
    return constraints.map((constraint) => ({
      plan_id: planId, user_id: userId, roster_id: rosterId,
      constraint_type: text(constraint.type, "조건 종류"),
      student_id: constraint.studentId ? uuid(constraint.studentId, "학생 ID") : null,
      related_student_id: constraint.relatedStudentId ? uuid(constraint.relatedStudentId, "관련 학생 ID") : null,
      constraint_config: constraint.config && typeof constraint.config === "object" ? constraint.config : {},
      priority: Number.isInteger(constraint.priority) ? constraint.priority : 1
    }));
  }
  async function savePlan(input, existingPlanId = null) {
    const plan = normalizePlan(input); const { client, userId } = await currentUser();
    const rosterId = await ownedRoster(client, userId, input.rosterId);
    let planId = existingPlanId ? uuid(existingPlanId, "자리표 ID") : null;
    const row = { user_id: userId, roster_id: rosterId, title: plan.title, plan_date: plan.planDate, layout_type: "single", layout_config: plan.layoutConfig, teacher_direction: input.teacherDirection || "north" };
    if (planId) {
      const { data, error } = await client.from("seating_plans").update(row).eq("id", planId).eq("user_id", userId).select("id").maybeSingle();
      if (error || !data) fail(error ? safeError(error, "자리표를 수정하지 못했습니다.") : "자리표를 찾을 수 없습니다.");
      const { error: assignmentError } = await client.from("seating_assignments").delete().eq("plan_id", planId).eq("user_id", userId);
      const { error: constraintError } = await client.from("seating_constraints").delete().eq("plan_id", planId).eq("user_id", userId);
      if (assignmentError || constraintError) fail(safeError(assignmentError || constraintError, "기존 자리표 내용을 정리하지 못했습니다."));
    } else {
      const { data, error } = await client.from("seating_plans").insert(row).select("id").single();
      if (error) fail(safeError(error, "자리표를 저장하지 못했습니다."));
      planId = data.id;
    }
    const assignments = assignmentRows(planId, userId, rosterId, plan.assignments);
    const constraints = constraintRows(planId, userId, rosterId, plan.constraints);
    if (assignments.length) { const { error } = await client.from("seating_assignments").insert(assignments); if (error) fail(safeError(error, "학생 자리 배치를 저장하지 못했습니다.")); }
    if (constraints.length) { const { error } = await client.from("seating_constraints").insert(constraints); if (error) fail(safeError(error, "자리 조건을 저장하지 못했습니다.")); }
    return planId;
  }
  async function listPlans(rosterId, month = "") {
    const { client, userId } = await currentUser(); const id = await ownedRoster(client, userId, rosterId);
    let query = client.from("seating_plans").select(PLAN_COLUMNS).eq("roster_id", id).eq("user_id", userId);
    if (/^\d{4}-\d{2}$/.test(month)) {
      const [year, monthIndex] = month.split("-").map(Number);
      const nextMonth = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
      query = query.gte("plan_date", `${month}-01`).lt("plan_date", nextMonth);
    }
    const { data, error } = await query.order("plan_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) fail(safeError(error, "저장된 자리표를 불러오지 못했습니다."));
    return data || [];
  }
  async function listPastNeighborPairs(rosterId, month = "") {
    const plans = await listPlans(rosterId, month);
    const planIds = plans.map((plan) => plan.id);
    if (!planIds.length) return [];
    const { client, userId } = await currentUser();
    const { data, error } = await client.from("seating_assignments").select("plan_id, student_id, row_index, column_index").eq("user_id", userId).in("plan_id", planIds);
    if (error) fail(safeError(error, "지난 자리표의 짝 정보를 불러오지 못했습니다."));
    const byPlan = new Map();
    (data || []).forEach((assignment) => {
      const rows = byPlan.get(assignment.plan_id) || [];
      rows.push(assignment); byPlan.set(assignment.plan_id, rows);
    });
    const pairs = new Set();
    byPlan.forEach((assignments) => assignments.forEach((student) => assignments.forEach((other) => {
      if (student.student_id !== other.student_id && student.row_index === other.row_index && Math.abs(student.column_index - other.column_index) === 1) {
        pairs.add([student.student_id, other.student_id].sort().join("::"));
      }
    })));
    return [...pairs];
  }
  async function getPlan(planId) {
    const { client, userId } = await currentUser(); const id = uuid(planId, "자리표 ID");
    const { data: plan, error } = await client.from("seating_plans").select(PLAN_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
    if (error || !plan) fail(error ? safeError(error, "자리표를 불러오지 못했습니다.") : "자리표를 찾을 수 없습니다.");
    const [{ data: assignments, error: assignmentError }, { data: constraints, error: constraintError }] = await Promise.all([
      client.from("seating_assignments").select("student_id, student_name_snapshot, seat_id, row_index, column_index, pair_id, group_id, is_fixed, assignment_source").eq("plan_id", id).eq("user_id", userId),
      client.from("seating_constraints").select("id, constraint_type, student_id, related_student_id, constraint_config, priority").eq("plan_id", id).eq("user_id", userId)
    ]);
    if (assignmentError || constraintError) fail(safeError(assignmentError || constraintError, "자리표 세부 정보를 불러오지 못했습니다."));
    return { ...plan, assignments: assignments || [], constraints: constraints || [] };
  }
  async function deletePlan(planId) {
    const { client, userId } = await currentUser(); const id = uuid(planId, "자리표 ID");
    const { error } = await client.from("seating_plans").delete().eq("id", id).eq("user_id", userId);
    if (error) fail(safeError(error, "자리표를 삭제하지 못했습니다."));
    return true;
  }
  window.kwonClassSeatingService = Object.freeze({ savePlan, listPlans, listPastNeighborPairs, getPlan, deletePlan });
})();

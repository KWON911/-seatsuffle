(() => {
  const ROSTER_COLUMNS = "id, roster_name, school_year, grade, class_name, is_default, created_at, updated_at";
  const STUDENT_COLUMNS = "id, roster_id, display_name, gender_code, student_number, sort_order, is_active, created_at, updated_at";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const GENDER_CODES = new Set(["male", "female", "unspecified"]);

  function fail(message) {
    throw new Error(message);
  }

  function getClient() {
    if (!window.kwonClassSupabase || !window.kwonClassSupabase.auth || !window.kwonClassSupabase.from) {
      fail("명단 서비스를 준비하지 못했습니다. Supabase 연결 설정을 확인해 주세요.");
    }

    return window.kwonClassSupabase;
  }

  function toSafeError(error, fallback) {
    const code = String(error?.code || "");
    const source = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

    if (code === "42501" || source.includes("permission") || source.includes("row-level security")) {
      return "이 작업을 수행할 권한이 없습니다.";
    }

    if (code === "23514" || source.includes("check constraint")) {
      return "입력값이 허용된 조건과 맞지 않습니다. 내용을 확인해 주세요.";
    }

    if (code === "23503" || source.includes("foreign key")) {
      return "연결된 학급 정보를 확인할 수 없습니다.";
    }

    if (code === "23505" && (source.includes("student_number") || source.includes("students_user_roster_student_number"))) {
      return "이 학급에는 이미 같은 학생 번호가 있습니다.";
    }

    if (code === "23505" || source.includes("unique constraint")) {
      return "기본 학급 설정이 충돌했습니다. 다시 시도해 주세요.";
    }

    if (source.includes("fetch") || source.includes("network") || source.includes("internet")) {
      return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
    }

    return fallback;
  }

  function throwDatabaseError(error, fallback) {
    if (error) {
      fail(toSafeError(error, fallback));
    }
  }

  function normalizeText(value, label) {
    const text = String(value ?? "").trim();
    if (!text) {
      fail(`${label}을(를) 입력해 주세요.`);
    }
    return text;
  }

  function normalizeInteger(value, label, minimum, maximum) {
    if (value === "" || value === null || value === undefined) {
      fail(`${label}을(를) 입력해 주세요.`);
    }

    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || (maximum !== undefined && number > maximum)) {
      const range = maximum === undefined ? `${minimum} 이상` : `${minimum}부터 ${maximum}까지`;
      fail(`${label}은(는) ${range}의 정수로 입력해 주세요.`);
    }
    return number;
  }

  function normalizeBoolean(value, label, defaultValue) {
    if (value === undefined) {
      return defaultValue;
    }
    if (typeof value !== "boolean") {
      fail(`${label} 값이 올바르지 않습니다.`);
    }
    return value;
  }

  function normalizeUuid(value, label) {
    const id = String(value || "").trim();
    if (!UUID_PATTERN.test(id)) {
      fail(`${label} 형식이 올바르지 않습니다.`);
    }
    return id;
  }

  function normalizeStudentNumber(value) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
      fail("학생 번호는 1 이상의 정수로 입력해 주세요.");
    }
    return normalizeInteger(text, "학생 번호", 1);
  }

  function normalizeRosterForCreate(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      roster_name: normalizeText(source.rosterName, "학급 이름"),
      school_year: normalizeInteger(source.schoolYear, "학년도", 2000, 2100),
      grade: normalizeInteger(source.grade, "학년", 1, 6),
      class_name: normalizeText(source.className, "반 이름"),
      is_default: normalizeBoolean(source.isDefault, "기본 학급", false)
    };
  }

  function normalizeRosterForUpdate(input) {
    const source = input && typeof input === "object" ? input : {};
    const changes = {};

    if (Object.prototype.hasOwnProperty.call(source, "rosterName")) {
      changes.roster_name = normalizeText(source.rosterName, "학급 이름");
    }
    if (Object.prototype.hasOwnProperty.call(source, "schoolYear")) {
      changes.school_year = normalizeInteger(source.schoolYear, "학년도", 2000, 2100);
    }
    if (Object.prototype.hasOwnProperty.call(source, "grade")) {
      changes.grade = normalizeInteger(source.grade, "학년", 1, 6);
    }
    if (Object.prototype.hasOwnProperty.call(source, "className")) {
      changes.class_name = normalizeText(source.className, "반 이름");
    }

    if (Object.keys(changes).length === 0) {
      fail("수정할 학급 정보가 없습니다.");
    }
    return changes;
  }

  function normalizeStudentForCreate(input, defaultSortOrder) {
    const source = input && typeof input === "object" ? input : {};
    const genderCode = source.genderCode === undefined || source.genderCode === null || source.genderCode === ""
      ? "unspecified"
      : String(source.genderCode);

    if (!GENDER_CODES.has(genderCode)) {
      fail("성별 정보는 남, 여, 미입력 중 하나로 선택해 주세요.");
    }

    const hasStudentNumber = source.studentNumber !== undefined
      && source.studentNumber !== null
      && String(source.studentNumber).trim() !== "";

    return {
      display_name: normalizeText(source.displayName, "학생 이름"),
      gender_code: genderCode,
      student_number: hasStudentNumber
        ? normalizeStudentNumber(source.studentNumber)
        : null,
      sort_order: source.sortOrder === undefined
        ? defaultSortOrder
        : normalizeInteger(source.sortOrder, "학생 순서", 0),
      is_active: normalizeBoolean(source.isActive, "학생 사용 여부", true)
    };
  }

  function normalizeStudentForUpdate(input) {
    const source = input && typeof input === "object" ? input : {};
    const changes = {};

    if (Object.prototype.hasOwnProperty.call(source, "displayName")) {
      changes.display_name = normalizeText(source.displayName, "학생 이름");
    }
    if (Object.prototype.hasOwnProperty.call(source, "genderCode")) {
      const genderCode = source.genderCode === undefined || source.genderCode === null || source.genderCode === ""
        ? "unspecified"
        : String(source.genderCode);
      if (!GENDER_CODES.has(genderCode)) {
        fail("성별 정보는 남, 여, 미입력 중 하나로 선택해 주세요.");
      }
      changes.gender_code = genderCode;
    }
    if (Object.prototype.hasOwnProperty.call(source, "studentNumber")) {
      const value = source.studentNumber;
      changes.student_number = value === undefined || value === null || String(value).trim() === ""
        ? null
        : normalizeStudentNumber(value);
    }
    if (Object.prototype.hasOwnProperty.call(source, "sortOrder")) {
      changes.sort_order = normalizeInteger(source.sortOrder, "학생 순서", 0);
    }
    if (Object.prototype.hasOwnProperty.call(source, "isActive")) {
      changes.is_active = normalizeBoolean(source.isActive, "학생 사용 여부", true);
    }

    if (Object.keys(changes).length === 0) {
      fail("수정할 학생 정보가 없습니다.");
    }
    return changes;
  }

  async function requireCurrentUser() {
    const client = getClient();
    const { data, error } = await client.auth.getUser();

    if (error) {
      const source = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
      if (source.includes("session") || source.includes("not authenticated")) {
        fail("로그인이 필요합니다.");
      }
      throwDatabaseError(error, "로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
    }

    if (!data.user?.id) {
      fail("로그인이 필요합니다.");
    }

    return { client, userId: data.user.id };
  }

  async function requireOwnedRoster(client, userId, rosterId) {
    const id = normalizeUuid(rosterId, "학급 ID");
    const { data, error } = await client
      .from("class_rosters")
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    throwDatabaseError(error, "학급을 찾을 수 없거나 접근할 수 없습니다.");
    if (!data) {
      fail("학급을 찾을 수 없거나 접근할 수 없습니다.");
    }

    return id;
  }

  async function listRosters() {
    const { client, userId } = await requireCurrentUser();
    const { data, error } = await client
      .from("class_rosters")
      .select(ROSTER_COLUMNS)
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("school_year", { ascending: false })
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("created_at", { ascending: true });

    throwDatabaseError(error, "학급 목록을 불러오지 못했습니다.");
    return data || [];
  }

  async function getRoster(rosterId) {
    const { client, userId } = await requireCurrentUser();
    const id = normalizeUuid(rosterId, "학급 ID");
    const { data, error } = await client
      .from("class_rosters")
      .select(ROSTER_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    throwDatabaseError(error, "학급을 찾을 수 없거나 접근할 수 없습니다.");
    if (!data) {
      fail("학급을 찾을 수 없거나 접근할 수 없습니다.");
    }
    return data;
  }

  async function createRoster(input) {
    const roster = normalizeRosterForCreate(input);
    const { client, userId } = await requireCurrentUser();
    const { data, error } = await client
      .from("class_rosters")
      .insert({ ...roster, user_id: userId })
      .select(ROSTER_COLUMNS)
      .single();

    throwDatabaseError(error, "학급을 저장하지 못했습니다.");

    if (roster.is_default) {
      await setDefaultRoster(data.id);
      return getRoster(data.id);
    }
    return data;
  }

  async function updateRoster(rosterId, input) {
    const id = normalizeUuid(rosterId, "학급 ID");
    const changes = normalizeRosterForUpdate(input);
    const { client, userId } = await requireCurrentUser();
    const { data, error } = await client
      .from("class_rosters")
      .update(changes)
      .eq("id", id)
      .eq("user_id", userId)
      .select(ROSTER_COLUMNS)
      .maybeSingle();

    throwDatabaseError(error, "학급 정보를 수정하지 못했습니다.");
    if (!data) {
      fail("학급을 찾을 수 없거나 접근할 수 없습니다.");
    }
    return data;
  }

  async function deleteRoster(rosterId) {
    const { client, userId } = await requireCurrentUser();
    const id = await requireOwnedRoster(client, userId, rosterId);

    // 데이터베이스의 ON DELETE CASCADE 규칙으로 연결된 학생도 함께 삭제됩니다.
    const { error } = await client
      .from("class_rosters")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    throwDatabaseError(error, "학급을 삭제하지 못했습니다.");
    return true;
  }

  async function setDefaultRoster(rosterId) {
    const { client, userId } = await requireCurrentUser();
    const id = await requireOwnedRoster(client, userId, rosterId);
    const { error } = await client.rpc("set_default_roster", { target_roster_id: id });

    throwDatabaseError(error, "기본 학급을 설정하지 못했습니다.");
    return true;
  }

  async function listStudents(rosterId, options = {}) {
    const { client, userId } = await requireCurrentUser();
    const id = await requireOwnedRoster(client, userId, rosterId);
    const includeInactive = options.includeInactive === true;
    let query = client
      .from("students")
      .select(STUDENT_COLUMNS)
      .eq("roster_id", id)
      .eq("user_id", userId);

    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    throwDatabaseError(error, "학생 명단을 불러오지 못했습니다.");
    return data || [];
  }

  async function createStudent(rosterId, input) {
    const student = normalizeStudentForCreate(input, 0);
    const { client, userId } = await requireCurrentUser();
    const id = await requireOwnedRoster(client, userId, rosterId);
    const { data, error } = await client
      .from("students")
      .insert({ ...student, roster_id: id, user_id: userId })
      .select(STUDENT_COLUMNS)
      .single();

    throwDatabaseError(error, "학생을 저장하지 못했습니다.");
    return data;
  }

  async function createStudents(rosterId, students) {
    if (!Array.isArray(students) || students.length === 0) {
      fail("저장할 학생 명단을 한 명 이상 입력해 주세요.");
    }
    if (students.length > 100) {
      fail("한 번에 저장할 학생은 100명까지 가능합니다.");
    }

    const normalizedStudents = students.map((student, index) => normalizeStudentForCreate(student, index));
    const { client, userId } = await requireCurrentUser();
    const id = await requireOwnedRoster(client, userId, rosterId);
    const rows = normalizedStudents.map((student) => ({ ...student, roster_id: id, user_id: userId }));
    const { data, error } = await client
      .from("students")
      .insert(rows)
      .select(STUDENT_COLUMNS);

    throwDatabaseError(error, "학생 명단을 저장하지 못했습니다.");
    return data || [];
  }

  async function updateStudent(studentId, input) {
    const id = normalizeUuid(studentId, "학생 ID");
    const changes = normalizeStudentForUpdate(input);
    const { client, userId } = await requireCurrentUser();
    const { data, error } = await client
      .from("students")
      .update(changes)
      .eq("id", id)
      .eq("user_id", userId)
      .select(STUDENT_COLUMNS)
      .maybeSingle();

    throwDatabaseError(error, "학생 정보를 수정하지 못했습니다.");
    if (!data) {
      fail("학생을 찾을 수 없거나 접근할 수 없습니다.");
    }
    return data;
  }

  async function deleteStudent(studentId) {
    const id = normalizeUuid(studentId, "학생 ID");
    const { client, userId } = await requireCurrentUser();
    const { data, error } = await client
      .from("students")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    throwDatabaseError(error, "학생을 삭제하지 못했습니다.");
    if (!data) {
      fail("학생을 찾을 수 없거나 접근할 수 없습니다.");
    }
    return true;
  }

  window.kwonClassRosterService = Object.freeze({
    listRosters,
    getRoster,
    createRoster,
    updateRoster,
    deleteRoster,
    setDefaultRoster,
    listStudents,
    createStudent,
    createStudents,
    updateStudent,
    deleteStudent
  });
})();

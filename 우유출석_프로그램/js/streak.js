/* ============================================================
   streak.js  —  "며칠 연속인가?" 와 "쿠폰 몇 장인가?" 계산
   ------------------------------------------------------------
   규칙
   1) 같은 날에 두 번 찍어도 하루로만 셉니다.
   2) 바로 전 '학교 가는 날'에 성공했으면 연속이 1 늘어납니다.
   3) 하루라도 빠뜨리면 연속은 1로 다시 시작합니다.
   4) 토·일요일과 공휴일은 '학교 가는 날'이 아니라서
      금요일에 먹고 월요일에 먹으면 연속이 유지됩니다.
   5) 연속이 목표(기본 5)의 배수가 될 때마다 쿠폰 1장!
   ============================================================ */

/* Date 객체 → '2026-10-10' 형태의 문자열 */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* 오늘 날짜 문자열 */
function todayStr() {
  return toDateStr(new Date());
}

/* '2026-10-10' → Date 객체 (시간은 00:00으로) */
function fromDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* 그 날이 '학교 가는 날'인가? */
function isSchoolDay(dateStr, cfg) {
  const d = fromDateStr(dateStr);
  const dow = d.getDay();                   // 0=일요일, 6=토요일
  if (cfg.skipWeekend && (dow === 0 || dow === 6)) return false;
  if ((cfg.holidays || []).includes(dateStr)) return false;
  return true;
}

/* 주어진 날짜의 '바로 전 학교 가는 날' 찾기
   예) 월요일에 물어보면 → 금요일을 돌려줍니다 */
function prevSchoolDay(dateStr, cfg) {
  const d = fromDateStr(dateStr);
  for (let i = 0; i < 60; i++) {            // 최대 60일까지만 거슬러 봄
    d.setDate(d.getDate() - 1);
    const s = toDateStr(d);
    if (isSchoolDay(s, cfg)) return s;
  }
  return null;
}

/* 학생 한 명의 빈 기록 만들기 */
function emptyRecord() {
  return {
    dates: [],        // 성공한 날짜들 ['2026-10-08', '2026-10-09', ...]
    streak: 0,        // 지금 몇 연속인지
    best: 0,          // 최고 기록
    coupons: 0,       // 받은 쿠폰 총 장수
    couponsUsed: 0,   // 선생님이 사용 처리한 장수
  };
}

/* ------------------------------------------------------------
   성공 기록 추가하기 (이 앱의 핵심 함수)
   rec    : 학생 한 명의 기록
   dateStr: 성공한 날 (보통 오늘)
   cfg    : 설정
   반환   : { status, rec, newCoupon }
            status 'added'   → 새로 기록됨
                   'already' → 오늘 이미 먹었음
   ------------------------------------------------------------ */
function addSuccess(rec, dateStr, cfg) {
  if (rec.dates.includes(dateStr)) {
    return { status: 'already', rec, newCoupon: false };
  }

  const last = rec.dates.length ? rec.dates[rec.dates.length - 1] : null;
  const prev = prevSchoolDay(dateStr, cfg);

  // 바로 전 학교 가는 날에 먹었으면 +1, 아니면 1로 시작
  const nextStreak = (last && last === prev) ? rec.streak + 1 : 1;

  const updated = {
    ...rec,
    dates: [...rec.dates, dateStr].sort(),
    streak: nextStreak,
    best: Math.max(rec.best, nextStreak),
  };

  // 목표의 배수가 되면 쿠폰 1장 추가 (5, 10, 15 …)
  const goal = cfg.streakGoal || 5;
  const newCoupon = nextStreak > 0 && nextStreak % goal === 0;
  if (newCoupon) updated.coupons = rec.coupons + 1;

  return { status: 'added', rec: updated, newCoupon };
}

/* 쿠폰 목표까지 몇 개 남았는지 (스탬프판 그릴 때 사용) */
function stampProgress(rec, cfg) {
  const goal = cfg.streakGoal || 5;
  const filled = rec.streak % goal;
  // 딱 목표를 채운 순간에는 판을 가득 찬 모습으로 보여줌
  const shown = (rec.streak > 0 && filled === 0) ? goal : filled;
  return { filled: shown, goal, left: goal - shown };
}

/* 오늘 이미 먹었는지 확인 */
function doneToday(rec) {
  return rec.dates.includes(todayStr());
}

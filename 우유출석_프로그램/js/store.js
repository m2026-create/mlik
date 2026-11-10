/* ============================================================
   store.js  —  데이터 저장/불러오기
   ------------------------------------------------------------
   기록은 '그 컴퓨터(태블릿)의 브라우저' 안에 저장됩니다.
   인터넷 서버로 보내지 않으므로 학생 정보가 밖으로 나가지 않습니다.
   단, 브라우저 데이터를 지우면 기록도 사라지니
   선생님 화면에서 가끔 [기록 내보내기]로 백업해 주세요.
   ============================================================ */

const STORAGE_KEY = 'milk-attendance-v1';

/* 저장된 것이 없을 때 쓰는 처음 상태 */
function freshState() {
  return {
    version: 1,
    config: { ...DEFAULT_CONFIG },
    records: {},        // { '김하준': {dates, streak, best, coupons, couponsUsed} }
    log: [],            // 모든 시도 기록 (파이썬으로 분석할 때 사용)
  };
}

/* 브라우저에서 불러오기 */
function loadState() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    console.warn('저장된 기록을 읽지 못했습니다:', e);
  }

  if (!saved) return freshState();

  // config.js 를 나중에 고쳐서 항목이 늘어났을 때도 깨지지 않게 합치기
  return {
    version: 1,
    config: { ...DEFAULT_CONFIG, ...(saved.config || {}) },
    records: saved.records || {},
    log: saved.log || [],
  };
}

/* 브라우저에 저장하기 */
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    alert('기록을 저장하지 못했어요. 저장 공간이 부족할 수 있습니다.');
    console.error(e);
    return false;
  }
}

/* 학생 한 명의 기록 가져오기 (없으면 빈 기록 만들어 줌) */
function getRecord(state, name) {
  if (!state.records[name]) state.records[name] = emptyRecord();
  return state.records[name];
}

/* 시도 하나를 log 에 남기기 — 성공/실패 모두 기록합니다.
   나중에 tools/report.py 로 "누가 몇 번 다시 찍었나" 같은
   분석을 할 수 있습니다. */
function appendLog(state, entry) {
  state.log.push({
    at: new Date().toISOString(),  // 찍은 시각
    date: todayStr(),              // 날짜
    ...entry,
  });
  // 로그가 너무 커지지 않게 최근 5000건만 유지
  if (state.log.length > 5000) state.log = state.log.slice(-5000);
}

/* 기록을 파일로 내보내기 (백업 + 파이썬 분석용) */
function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `우유출석_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

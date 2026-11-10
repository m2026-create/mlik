/* ============================================================
   app.js  -  앱의 흐름을 담당하는 파일

   전체 흐름
   [우리 반 현황] -> [출석하기] -> [찍기 또는 사진 올리기]
   -> [누구인지 판별] -> [그 학생으로 출석 인정] -> [결과]

   판별 방법 (중요!)
   이름을 먼저 고르지 않습니다. 모델에게 바로
   "이 글씨는 누구야?" 를 묻고, 1위 확률이 선생님이 정한
   '인식 기준(%)' 을 넘으면 그 학생으로 출석을 인정합니다.
   ============================================================ */

/* ---------- 앱이 기억하는 것들 ---------- */
let state = loadState();      // 설정 + 기록
let model = null;             // 티처블 머신 모델
let modelLabels = [];         // 모델이 가진 클래스 이름들
let stream = null;            // 카메라 영상
let current = null;           // 방금 인정된 학생 (결과/내 기록용)
let busy = false;             // 판별 중 중복 클릭 막기
let lastOk = false;           // 마지막 결과가 성공이었는지
let camList = [];             // 이 기기에서 쓸 수 있는 카메라 목록
let camIndex = 0;             // 그중 지금 쓰고 있는 것

/* 고른 카메라는 이 기기에만 저장해 둡니다 (다음에 켤 때 그대로 쓰려고) */
const CAM_KEY = 'milk-camera-v1';

/* ---------- 자주 쓰는 짧은 함수 ---------- */
const $ = (id) => document.getElementById(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* 화면 바꾸기 */
function show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(screenId).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* 글자를 화면에 넣을 때 태그로 해석되지 않게 막기 */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* =============================================================
   1. 시작하기
   ============================================================= */
function init() {
  $('classLabel').textContent = state.config.className;
  renderHome();
  bindEvents();

  // 모델 주소가 있으면 미리 불러오기 (학생이 기다리지 않게)
  if (state.config.modelURL) {
    loadModel(state.config.modelURL).catch((e) => {
      console.error(e);
      $('modelWarn').classList.remove('hidden');
      $('modelWarn').innerHTML =
        '⚠️ 모델을 불러오지 못했어요.<br>모델 주소를 다시 확인해 주세요.';
    });
  } else {
    $('modelWarn').classList.remove('hidden');
  }
}

/* =============================================================
   2. 티처블 머신 모델 불러오기
   ============================================================= */
async function loadModel(baseURL) {
  const url = baseURL.endsWith('/') ? baseURL : baseURL + '/';
  model = await tmImage.load(url + 'model.json', url + 'metadata.json');
  modelLabels = model.getClassLabels();
  console.log('모델 클래스:', modelLabels);
  return modelLabels;
}

/* =============================================================
   3. 통계 계산 — 메인 화면에서 쓰는 숫자들
   ------------------------------------------------------------
   '이번 달' 을 기준으로 셉니다. 달이 바뀌면 다시 출발하니
   지난달에 많이 놓친 학생도 새로 시작할 수 있습니다.
   ============================================================= */

/* 이번 달 접두사 ('2026-11') */
function thisMonth() {
  return todayStr().slice(0, 7);
}

/* 이번 달에 우유를 먹은 날 수 */
function monthCount(rec) {
  const m = thisMonth();
  return rec.dates.filter((d) => d.startsWith(m)).length;
}

/* 이번 달 1일부터 오늘까지의 '학교 가는 날' 수 */
function monthSchoolDays() {
  const now = new Date();
  const last = now.getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const ds = toDateStr(new Date(now.getFullYear(), now.getMonth(), d));
    if (isSchoolDay(ds, state.config)) n++;
  }
  return n;
}

/* 이번 달에 놓친 날 수 (학교 가는 날 중 못 먹은 날) */
function monthMissed(rec) {
  return Math.max(0, monthSchoolDays() - monthCount(rec));
}

/* 학생마다 이번 달 성적을 모아서 많이 먹은 차례로 정렬 */
function rankedStudents() {
  return state.config.roster
    .map((s) => {
      const rec = getRecord(state, s.name);
      return {
        student: s,
        rec: rec,
        count: monthCount(rec),
        missed: monthMissed(rec),
        streak: rec.streak,
        coupons: rec.coupons - rec.couponsUsed,
        today: doneToday(rec),
      };
    })
    .sort((a, b) =>
      b.count - a.count ||            // 많이 먹은 사람 먼저
      b.streak - a.streak ||          // 같으면 연속이 긴 사람
      a.student.name.localeCompare(b.student.name));
}

/* =============================================================
   4. 메인 화면 그리기
   ============================================================= */
function renderHome() {
  const list = rankedStudents();
  const all = list.length;
  const doneCount = list.filter((r) => r.today).length;

  /* ---- 오늘 우리 반 현황 ---- */
  $('todayDone').textContent = doneCount;
  $('todayAll').textContent = '/ ' + all + '명';
  $('classBarFill').style.width = all ? (doneCount / all) * 100 + '%' : '0%';

  const rate = all ? doneCount / all : 0;
  $('todayMsg').textContent =
    doneCount === 0 ? '오늘 첫 번째 주인공은 누구일까요?' :
    rate >= 1       ? '우와! 모두 다 먹었어요! 🎉' :
    rate >= 0.7     ? '거의 다 왔어요! 조금만 더! 💪' :
    rate >= 0.3     ? '하나 둘 모이고 있어요! 🥛' :
                      '함께 채워봐요!';

  /* ---- 시상대 (이번 달 많이 먹은 친구 셋) ---- */
  const pod = $('podium');
  const top = list.filter((r) => r.count > 0).slice(0, 3);

  if (!top.length) {
    pod.innerHTML = '<p class="podium-empty">이번 달 첫 꿀꺽을 기다리고 있어요!</p>';
  } else {
    // 보기 좋게 2등 - 1등 - 3등 순서로 세웁니다
    const order = [top[1], top[0], top[2]].filter(Boolean);
    const medal = { 0: '🥇', 1: '🥈', 2: '🥉' };
    pod.innerHTML = '';
    order.forEach((r) => {
      const place = top.indexOf(r);                     // 0,1,2
      const b = document.createElement('button');
      b.className = 'pod pod' + (place + 1);
      b.innerHTML =
        '<div class="medal">' + medal[place] + '</div>' +
        '<div class="face">' + esc(r.student.emoji || '🥛') + '</div>' +
        '<div class="nm">' + esc(r.student.name) + '</div>' +
        '<div class="cnt">' + r.count + '번 꿀꺽</div>' +
        (r.streak >= 2 ? '<div class="fire">🔥 ' + r.streak + '일 연속</div>' : '');
      b.onclick = () => openMy(r.student);
      pod.appendChild(b);
    });
  }

  /* ---- 반 전체 기록 ---- */
  const maxCount = Math.max(1, ...list.map((r) => r.count));
  const box = $('rankList');
  box.innerHTML = '';

  list.forEach((r, i) => {
    const row = document.createElement('button');
    row.className = 'rank-row';
    row.innerHTML =
      '<span class="rank-no">' + (i + 1) + '</span>' +
      '<span class="rank-face">' + esc(r.student.emoji || '🥛') + '</span>' +
      '<span class="rank-mid">' +
        '<span class="rank-nm">' + esc(r.student.name) +
          (r.today ? '<span class="today-dot" title="오늘 먹었어요">✅</span>' : '') +
        '</span>' +
        '<span class="rank-bar"><i style="width:' +
          (r.count / maxCount) * 100 + '%"></i></span>' +
        '<span class="rank-sub">' +
          (r.streak >= 2 ? '🔥 ' + r.streak + '일 연속 · ' : '') +
          '놓친 날 ' + r.missed + '일' +
          (r.coupons > 0 ? ' · 🎟️ ' + r.coupons : '') +
        '</span>' +
      '</span>' +
      '<span class="rank-right"><b>' + r.count + '</b>번</span>';
    row.onclick = () => openMy(r.student);
    box.appendChild(row);
  });

  $('homeHint').textContent = model
    ? '우유갑에 쓴 이름을 보여주면 누구인지 알아맞혀요!'
    : '모델이 준비되면 출석할 수 있어요.';
}

/* =============================================================
   5. 카메라 켜기 — 이제 이름을 먼저 고르지 않습니다
   ============================================================= */
async function startCheckin() {
  if (!model) {
    alert('아직 준비가 안 됐어요. 선생님께 알려주세요!');
    return;
  }
  $('camHint').textContent = '';
  show('screen-camera');

  // 지난번에 고른 카메라가 있으면 그걸로, 없으면 뒷면 카메라로 켭니다.
  const pref = loadCamPref();
  let ok = await openStream(pref);

  // 저장해 둔 카메라가 사라졌거나(USB 뽑음 등) 쓸 수 없으면 기본값으로 다시
  if (!ok && pref.deviceId) {
    saveCamPref({});
    ok = await openStream({});
  }

  if (!ok) {
    // 카메라가 안 되더라도 '사진 올리기' 로는 출석할 수 있습니다
    $('camHint').innerHTML =
      '카메라를 켤 수 없어요. 브라우저에서 카메라 사용을 <b>허용</b>해 주세요.<br>' +
      '아래 <b>🖼️ 사진 올리기</b> 로도 출석할 수 있어요!';
    $('btnCamSwitch').classList.add('hidden');
    $('btnShoot').disabled = true;
    return;
  }

  $('btnShoot').disabled = false;
  await refreshCamList();
}

/* 실제로 카메라를 켜는 부분. 성공하면 true */
async function openStream(pref) {
  const video = { width: { ideal: 1280 }, height: { ideal: 960 } };

  if (pref && pref.deviceId) {
    video.deviceId = { exact: pref.deviceId };   // 고른 카메라가 있으면 그것만
  } else {
    video.facingMode = 'environment';            // 뒷면 카메라 우선 (우유갑 찍기 편하게)
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    $('video').srcObject = stream;
    return true;
  } catch (e) {
    console.error(e);
    stream = null;
    return false;
  }
}

/* 이 기기에 카메라가 몇 개 있는지 살펴보고, 2개 이상이면 바꾸기 단추를 보여줍니다.
   (카메라 이름표는 사용을 허용한 뒤에야 보이기 때문에 켠 다음에 확인합니다) */
async function refreshCamList() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    camList = all.filter((d) => d.kind === 'videoinput');
  } catch (e) {
    console.error(e);
    camList = [];
  }

  const nowId = currentCamId();
  const found = camList.findIndex((d) => d.deviceId === nowId);
  camIndex = found >= 0 ? found : 0;

  const btn = $('btnCamSwitch');
  if (camList.length > 1) {
    btn.classList.remove('hidden');
    $('camSwitchLabel').textContent = camName(camList[camIndex], camIndex);
  } else {
    btn.classList.add('hidden');
  }
}

/* 지금 켜져 있는 카메라의 id */
function currentCamId() {
  const track = stream && stream.getVideoTracks()[0];
  if (!track || !track.getSettings) return '';
  return track.getSettings().deviceId || '';
}

/* 카메라 이름을 아이들이 알아보게 바꿔줍니다 */
function camName(dev, i) {
  const label = (dev && dev.label) || '';
  if (/front|user|facing front|전면/i.test(label)) return '앞 카메라';
  if (/back|rear|environment|후면/i.test(label)) return '뒤 카메라';
  if (label) return label.length > 14 ? label.slice(0, 14) + '…' : label;
  return '카메라 ' + (i + 1);
}

/* 다음 카메라로 바꾸기 (앞 <-> 뒤, 웹캠이 여러 개면 차례로) */
async function switchCamera() {
  if (camList.length < 2) return;

  const btn = $('btnCamSwitch');
  btn.disabled = true;
  $('camHint').textContent = '';

  const before = camIndex;
  camIndex = (camIndex + 1) % camList.length;
  const dev = camList[camIndex];

  stopCamera();
  const ok = await openStream({ deviceId: dev.deviceId });

  if (ok) {
    saveCamPref({ deviceId: dev.deviceId });
    $('camSwitchLabel').textContent = camName(dev, camIndex);
  } else {
    // 안 되면 원래 쓰던 카메라로 되돌립니다
    camIndex = before;
    await openStream(loadCamPref());
    $('camHint').textContent = '그 카메라는 지금 쓸 수 없어요. 다시 눌러 보세요.';
  }

  btn.disabled = false;
}

/* 고른 카메라 기억하기 — 이 기기 안에만 저장됩니다 */
function loadCamPref() {
  try {
    return JSON.parse(localStorage.getItem(CAM_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveCamPref(pref) {
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify(pref));
  } catch (e) {
    /* 저장이 안 돼도 쓰는 데는 문제없습니다 */
  }
}

/* 카메라 끄기 (안 끄면 불이 계속 켜져 있어요) */
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  $('video').srcObject = null;
}

/* =============================================================
   6. 판별하기 - 이 앱의 가장 중요한 부분
   ------------------------------------------------------------
   사진 한 장을 받아서 "누구인가" 를 돌려줍니다.
   통과 조건
     1) 1위 클래스가 우리 반 명단에 있는 학생일 것
        ('우유갑아님' 같은 클래스면 실패)
     2) 1위 확률 >= 인식 기준 (선생님이 % 로 정함)
     3) 1위와 2위의 차이 >= 차이 기준 (헷갈릴 때 막아줌)
   ============================================================= */
async function identify(canvas) {
  const cfg = state.config;

  let preds;
  try {
    preds = await model.predict(canvas);
  } catch (e) {
    console.error(e);
    return { ok: false, reason: 'error' };
  }

  preds = preds.slice().sort((a, b) => b.probability - a.probability);
  const top1 = preds[0];
  const top2 = preds[1] || { className: '', probability: 0 };

  // 1위 클래스를 가진 학생이 명단에 있는지 찾기
  const student = cfg.roster.find((s) => (s.label || s.name) === top1.className);

  const recogOk  = top1.probability >= cfg.confidenceMin;
  const marginOk = (top1.probability - top2.probability) >= (cfg.marginMin || 0);

  let reason = 'pass';
  if (!student)       reason = 'notstudent';   // 우유갑이 아니거나 모르는 클래스
  else if (!recogOk)  reason = 'lowconf';      // 흐릿함 / 확신 부족
  else if (!marginOk) reason = 'unsure';       // 두 사람 사이에서 헷갈림

  return {
    ok: reason === 'pass',
    reason,
    student,
    top1: top1.className,
    p1: Number(top1.probability.toFixed(4)),
    p2: Number(top2.probability.toFixed(4)),
    c2: top2.className,
  };
}

/* 판별된 학생에게 오늘 출석을 찍어 줍니다.
   돌려주는 status: 'new'(새로 찍음) | 'already'(오늘 이미 먹음) */
function applyAttendance(info, practice, photo) {
  const entry = {
    ok: info.ok,
    reason: info.reason,
    name: info.student ? info.student.name : '(모름)',
    top1: info.top1,
    p1: info.p1,
    p2: info.p2,
    practice,
  };
  if (photo) entry.photo = photo;

  if (practice) return { status: 'practice', streakInfo: null };

  appendLog(state, entry);                       // 성공·실패 모두 기록

  if (!info.ok) { saveState(state); return { status: 'fail', streakInfo: null }; }

  const rec = getRecord(state, info.student.name);
  const res = addSuccess(rec, todayStr(), state.config);
  state.records[info.student.name] = res.rec;
  saveState(state);

  return { status: res.status === 'already' ? 'already' : 'new', streakInfo: res };
}

/* 영상이나 사진을 모델이 먹을 수 있는 224x224 정사각형으로 다듬기 */
function toSquare(source, sw, sh) {
  const canvas = $('canvas');
  const size = 224;
  canvas.width = size;
  canvas.height = size;

  const side = Math.min(sw, sh);                 // 짧은 쪽 기준
  const sx = (sw - side) / 2;                    // 가운데 자르기
  const sy = (sh - side) / 2;
  canvas.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/* ---------- (가) 카메라로 찍기 ---------- */
async function shoot() {
  if (busy || !model || !stream) return;
  busy = true;
  $('btnShoot').disabled = true;

  // 찰칵 효과
  $('camFlash').classList.add('on');
  setTimeout(() => $('camFlash').classList.remove('on'), 450);

  const video = $('video');
  const canvas = toSquare(video, video.videoWidth || 640, video.videoHeight || 480);

  $('checkingText').textContent = '누구인지 살펴보는 중…';
  $('checkingSub').textContent = '잠깐만 기다려 주세요!';
  show('screen-checking');

  const info = await identify(canvas);
  const practice = $('practiceMode').checked;

  const photo = (state.config.savePhoto && info.ok && !practice)
    ? canvas.toDataURL('image/jpeg', 0.5) : null;

  const applied = applyAttendance(info, practice, photo);

  stopCamera();
  busy = false;
  $('btnShoot').disabled = false;

  showResult(info, applied, practice);
}

/* ---------- (나) 사진 올리기 ----------
   카메라 대신 쓰는 길입니다. 여러 장을 한꺼번에 고르면
   한 장씩 판별해서 각각의 학생에게 출석을 찍어 줍니다. */
async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length || !model || busy) return;

  busy = true;
  stopCamera();
  const practice = $('practiceMode').checked;

  $('checkingText').textContent = '사진을 살펴보는 중…';
  show('screen-checking');

  const results = [];
  for (let i = 0; i < files.length; i++) {
    $('checkingSub').textContent = (i + 1) + ' / ' + files.length + '장';

    let info, applied;
    try {
      const img = await readImage(files[i]);
      const canvas = toSquare(img, img.naturalWidth, img.naturalHeight);
      info = await identify(canvas);
      const photo = (state.config.savePhoto && info.ok && !practice)
        ? canvas.toDataURL('image/jpeg', 0.5) : null;
      applied = applyAttendance(info, practice, photo);
    } catch (e) {
      console.error(files[i].name, e);
      info = { ok: false, reason: 'error' };
      applied = { status: 'fail', streakInfo: null };
    }

    results.push({ file: files[i].name, info, applied });
    await new Promise((r) => setTimeout(r, 0));   // 화면이 멈춰 보이지 않게 양보
  }

  busy = false;
  $('filePhoto').value = '';                      // 같은 파일을 다시 고를 수 있게

  // 한 장이면 평소 결과 화면, 여러 장이면 요약 화면
  if (results.length === 1) {
    showResult(results[0].info, results[0].applied, practice);
  } else {
    showBatch(results, practice);
  }
}

/* 파일 하나를 <img> 로 읽기 (사진은 밖으로 나가지 않습니다) */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없음')); };
    img.src = url;
  });
}

/* =============================================================
   7. 결과 보여주기 (사진 한 장)
   ============================================================= */
function showResult(info, applied, practice) {
  lastOk = !!info.ok;
  current = info.student || null;

  const card = $('resultCard');
  const cfg = state.config;
  $('couponPop').classList.add('hidden');
  $('whoLine').classList.add('hidden');

  if (info.ok) {
    /* ----- 누구인지 알아냈다! ----- */
    card.classList.remove('fail');
    $('resultEmoji').textContent = info.student.emoji || pick(['🎉', '🥳', '✨', '🌟', '🥛']);
    $('resultTitle').textContent = info.student.name + ' 확인 완료!';

    // 몇 %로 알아봤는지 알려주면 아이들이 재미있어 합니다
    $('whoLine').textContent =
      '모델이 ' + Math.round(info.p1 * 100) + '% 확신했어요';
    $('whoLine').classList.remove('hidden');

    $('resultMsg').textContent = practice
      ? '연습 모드예요. 기록에는 남지 않아요!'
      : pick(PRAISE);

    const rec = getRecord(state, info.student.name);
    drawStamps(rec);

    if (practice) {
      $('streakLine').textContent = '연습이라 도장은 안 찍었어요';
    } else if (applied.status === 'already') {
      $('streakLine').textContent = '오늘은 이미 먹었어요! 😊';
    } else {
      const { left } = stampProgress(rec, cfg);
      $('streakLine').textContent =
        rec.streak + '일 연속! ' +
        (left > 0 ? '쿠폰까지 ' + left + '개 남았어요' : '도장판을 다 채웠어요!');
    }

    if (applied.streakInfo && applied.streakInfo.newCoupon) {
      $('couponPop').classList.remove('hidden');
      $('couponWhy').textContent = rec.streak + '일 연속 성공 보상';
      rain(60);
    } else if (!practice && applied.status === 'new') {
      rain(26);
    }

    $('btnRetry').classList.add('hidden');
  } else {
    /* ----- 못 알아봤다 ----- */
    card.classList.add('fail');
    $('resultEmoji').textContent = '🤔';
    $('resultTitle').textContent = '다시 한 번!';

    const guide = {
      notstudent: '우유갑 이름이 잘 안 보여요. 이름이 크게 보이게 찍어주세요!',
      lowconf:    '누구인지 확실하지 않아요. 밝은 곳에서 가까이 찍어주세요!',
      unsure:     '두 친구 사이에서 헷갈려요. 이름을 똑바로 맞춰주세요!',
      error:      '앗, 문제가 생겼어요. 선생님께 알려주세요!',
    };
    $('resultMsg').textContent = guide[info.reason] || pick(RETRY_MSG);

    // 아깝게 떨어졌을 때는 몇 %였는지 보여주면 다시 찍기 쉬워집니다
    if (info.p1 !== undefined) {
      $('whoLine').textContent =
        '가장 비슷한 건 ' + esc(info.top1) + ' (' + Math.round(info.p1 * 100) + '%) · ' +
        '기준 ' + Math.round(state.config.confidenceMin * 100) + '%';
      $('whoLine').classList.remove('hidden');
    }

    $('stampboard').innerHTML = '';
    $('streakLine').textContent = '';
    $('btnRetry').classList.remove('hidden');
  }

  show('screen-result');
}

/* =============================================================
   8. 결과 보여주기 (사진 여러 장을 한 번에)
   ============================================================= */
function showBatch(results, practice) {
  let ok = 0, dup = 0, ng = 0, coupon = 0;

  const box = $('batchList');
  box.innerHTML = '';

  results.forEach((r) => {
    const info = r.info;
    let tag, cls;

    if (info.ok && r.applied.status === 'already') { dup++; tag = '이미 먹음'; cls = 'dup'; }
    else if (info.ok) { ok++; tag = '출석!'; cls = 'ok'; }
    else { ng++; tag = '모르겠어요'; cls = 'ng'; }

    if (r.applied.streakInfo && r.applied.streakInfo.newCoupon) coupon++;

    const row = document.createElement('div');
    row.className = 'batch-row';
    row.innerHTML =
      '<span class="bface">' +
        (info.student ? esc(info.student.emoji || '🥛') : '❓') + '</span>' +
      '<span class="bmid">' +
        '<span>' + (info.student ? esc(info.student.name) : '알 수 없음') +
          (info.p1 !== undefined
            ? ' <small style="color:var(--gray)">' + Math.round(info.p1 * 100) + '%</small>'
            : '') +
        '</span>' +
        '<span class="bfile">' + esc(r.file) + '</span>' +
      '</span>' +
      '<span class="btag ' + cls + '">' + tag + '</span>';
    box.appendChild(row);
  });

  $('batchTitle').textContent = practice
    ? '연습 모드 — 기록에는 안 남았어요'
    : '사진 ' + results.length + '장 정리 끝!';
  $('batchOk').textContent = ok;
  $('batchDup').textContent = dup;
  $('batchNg').textContent = ng;
  $('batchCoupon').textContent = coupon;

  if (ok > 0 && !practice) rain(coupon > 0 ? 60 : 30);

  show('screen-batch');
}

/* 도장판 그리기 */
function drawStamps(rec) {
  const { filled, goal } = stampProgress(rec, state.config);
  const box = $('stampboard');
  box.innerHTML = '';
  for (let i = 0; i < goal; i++) {
    const s = document.createElement('div');
    s.className = 'stamp' + (i < filled ? ' on' : '');
    s.textContent = i < filled ? '🥛' : i + 1;
    box.appendChild(s);
  }
}

/* 색종이 뿌리기 */
function rain(count) {
  const box = $('confetti');
  const emojis = ['🥛', '⭐', '🎉', '💛', '🐄', '✨'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'piece';
    p.textContent = pick(emojis);
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = 2.2 + Math.random() * 1.8 + 's';
    p.style.animationDelay = Math.random() * 0.5 + 's';
    box.appendChild(p);
    setTimeout(() => p.remove(), 4600);
  }
}

/* =============================================================
   9. 내 기록 화면
   ============================================================= */
function openMy(student) {
  current = student;
  const rec = getRecord(state, student.name);

  $('myEmoji').textContent = student.emoji || '🥛';
  $('myName').textContent = student.name;
  $('statStreak').textContent = rec.streak;
  $('statTotal').textContent = monthCount(rec);
  $('statMiss').textContent = monthMissed(rec);
  $('statCoupon').textContent = rec.coupons - rec.couponsUsed;

  drawCalendar(rec);
  show('screen-my');
}

/* 이번 달 달력에 우유 도장 찍기 */
function drawCalendar(rec) {
  const box = $('calendar');
  box.innerHTML = '';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = todayStr();

  // 요일 머리글
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) => {
    const h = document.createElement('div');
    h.className = 'cal-head' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    h.textContent = d;
    box.appendChild(h);
  });

  // 1일 앞의 빈 칸
  const firstDow = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstDow; i++) {
    const e = document.createElement('div');
    e.className = 'cal-cell empty';
    box.appendChild(e);
  }

  // 날짜 칸
  const lastDate = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= lastDate; d++) {
    const ds = toDateStr(new Date(year, month, d));
    const cell = document.createElement('div');
    cell.className = 'cal-cell'
      + (rec.dates.includes(ds) ? ' on' : '')
      + (ds === today ? ' today' : '');
    cell.textContent = d;
    box.appendChild(cell);
  }
}

/* =============================================================
   10. 선생님 화면
   ============================================================= */
function openTeacher() {
  const pin = prompt('선생님 비밀번호를 입력하세요');
  if (pin === null) return;
  if (pin !== String(state.config.teacherPin)) {
    alert('비밀번호가 달라요!');
    return;
  }

  stopCamera();
  const c = state.config;
  $('cfgClassName').value = c.className;
  $('cfgModelURL').value = c.modelURL;
  $('cfgRecog').value = Math.round(c.confidenceMin * 100);
  $('cfgRecogVal').textContent = Math.round(c.confidenceMin * 100) + '%';
  $('cfgMargin').value = c.marginMin;
  $('cfgGoal').value = c.streakGoal;
  $('cfgSkipWeekend').checked = c.skipWeekend;
  $('cfgSavePhoto').checked = c.savePhoto;
  $('cfgHolidays').value = (c.holidays || []).join('\n');
  $('cfgRoster').value = c.roster
    .map((s) => `${s.name}, ${s.label || s.name}, ${s.emoji || '🥛'}`)
    .join('\n');
  $('modelTestResult').textContent = '';

  renderTeacherTable();
  show('screen-teacher');
}

/* 설정 저장 */
function saveConfig() {
  const c = state.config;

  c.className = $('cfgClassName').value.trim() || '우리 반';
  c.modelURL = $('cfgModelURL').value.trim();
  // 슬라이더의 % 를 0~1 사이 숫자로 바꿔서 저장합니다
  c.confidenceMin = Math.min(0.99, Math.max(0.4, Number($('cfgRecog').value) / 100 || 0.8));
  c.marginMin = Math.min(0.9, Math.max(0, Number($('cfgMargin').value) || 0));
  c.streakGoal = Math.max(2, parseInt($('cfgGoal').value, 10) || 5);
  c.skipWeekend = $('cfgSkipWeekend').checked;
  c.savePhoto = $('cfgSavePhoto').checked;

  c.holidays = $('cfgHolidays').value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

  // '이름, 클래스명, 이모지' 한 줄씩 읽기
  const roster = $('cfgRoster').value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, label, emoji] = line.split(',').map((x) => (x || '').trim());
      return { name, label: label || name, emoji: emoji || '🥛' };
    })
    .filter((s) => s.name);

  if (roster.length === 0) {
    alert('명단이 비어 있어요! 한 명 이상 적어주세요.');
    return;
  }
  c.roster = roster;

  saveState(state);
  $('classLabel').textContent = c.className;
  renderHome();

  // 모델 주소가 바뀌었으면 다시 불러오기
  if (c.modelURL) {
    loadModel(c.modelURL)
      .then(() => {
        $('modelWarn').classList.add('hidden');
        renderHome();
        alert('저장했어요! 모델도 잘 연결됐습니다. 👍');
        show('screen-home');
      })
      .catch(() => {
        alert('저장은 됐지만 모델 주소를 확인해 주세요.');
      });
  } else {
    alert('저장했어요!');
    show('screen-home');
  }
}

/* 모델 연결 확인 버튼 */
async function testModel() {
  const url = $('cfgModelURL').value.trim();
  const out = $('modelTestResult');
  if (!url) { out.textContent = '주소를 먼저 넣어주세요.'; return; }

  out.textContent = '확인 중…';
  try {
    const labels = await loadModel(url);
    // 명단에 적힌 클래스명이 모델에 다 있는지 검사 -> 흔한 실수를 잡아줍니다
    const missing = state.config.roster
      .map((s) => s.label || s.name)
      .filter((l) => !labels.includes(l));

    out.innerHTML =
      `✅ 연결 성공! 클래스 ${labels.length}개<br>` +
      `<small>${labels.join(' / ')}</small>` +
      (missing.length
        ? `<br>⚠️ 명단에 있는데 모델에 없는 클래스: <b>${missing.join(', ')}</b>`
        : '<br>명단과 모델 클래스가 모두 일치합니다 👍');
  } catch (e) {
    // 흔한 실수를 짚어서 알려줍니다
    const local = !/^https?:\/\//i.test(url);
    out.innerHTML =
      '❌ 모델을 불러오지 못했어요.<br>' +
      (local
        ? '<small>· <b>' + url + '</b> 폴더 안에 <b>model.json · weights.bin · metadata.json</b> ' +
          '3개가 모두 있는지 확인하세요<br>' +
          '· zip 안에 폴더가 한 겹 더 있는 경우가 많아요 (model/model/model.json ❌)<br>' +
          '· <b>.tm 파일</b>은 쓸 수 없어요. [모델 내보내기 → Tensorflow.js → 다운로드]로 받으세요</small>'
        : '<small>· 주소 끝에 <b>/</b> 가 있는지 확인하세요<br>' +
          '· 티처블 머신에서 <b>업로드</b> 버튼까지 눌렀는지 확인하세요</small>') +
      '<br><small style="opacity:.6">' + e.message + '</small>';
  }
}

/* 선생님용 현황표 */
function renderTeacherTable() {
  const box = $('teacherTable');
  box.innerHTML = '';

  state.config.roster.forEach((s) => {
    const rec = getRecord(state, s.name);
    const left = rec.coupons - rec.couponsUsed;

    const row = document.createElement('div');
    row.className = 'trow';
    row.innerHTML = `
      <span>${s.emoji || '🥛'}</span>
      <span class="t-name">${esc(s.name)}${doneToday(rec) ? ' ✅' : ''}</span>
      <span class="t-num">${rec.streak}연속 / 이달 ${monthCount(rec)}</span>
      <span class="t-cp">🎟️ ${left}</span>
    `;

    // 쿠폰 사용 처리 버튼
    const useBtn = document.createElement('button');
    useBtn.textContent = '사용';
    useBtn.disabled = left <= 0;
    useBtn.onclick = () => {
      if (!confirm(`${s.name} 쿠폰 1장을 사용 처리할까요?`)) return;
      rec.couponsUsed += 1;
      saveState(state);
      renderTeacherTable();
      renderHome();
    };
    row.appendChild(useBtn);

    // 오늘 수동 인정 (모델이 계속 못 맞힐 때 대비)
    const okBtn = document.createElement('button');
    okBtn.textContent = '오늘인정';
    okBtn.disabled = doneToday(rec);
    okBtn.onclick = () => {
      if (!confirm(`${s.name}의 오늘 우유를 선생님이 직접 인정할까요?`)) return;
      const res = addSuccess(rec, todayStr(), state.config);
      state.records[s.name] = res.rec;
      appendLog(state, { ok: true, reason: 'manual', name: s.name, top1: '(수동)', p1: 1, p2: 0 });
      saveState(state);
      renderTeacherTable();
      renderHome();
    };
    row.appendChild(okBtn);

    box.appendChild(row);
  });
}

/* 기록 불러오기 (백업 파일에서) */
function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.records) throw new Error('기록이 없는 파일이에요');
      if (!confirm('지금 기록을 덮어씁니다. 계속할까요?')) return;

      state = {
        version: 1,
        config: { ...DEFAULT_CONFIG, ...(data.config || {}) },
        records: data.records,
        log: data.log || [],
      };
      saveState(state);
      alert('불러왔어요!');
      location.reload();
    } catch (e) {
      alert('파일을 읽지 못했어요: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/* =============================================================
   11. 버튼 연결
   ============================================================= */
function bindEvents() {
  $('btnTeacher').onclick = openTeacher;

  // 메인 화면의 출석하기
  $('btnCheckin').onclick = startCheckin;

  $('btnShoot').onclick = shoot;
  $('btnCamSwitch').onclick = switchCamera;
  $('btnBackHome').onclick = () => { stopCamera(); renderHome(); show('screen-home'); };

  // 사진 올리기 (카메라 대신)
  $('btnPickPhoto').onclick = () => $('filePhoto').click();
  $('filePhoto').onchange = (e) => {
    if (e.target.files && e.target.files.length) handleFiles(e.target.files);
  };

  $('btnRetry').onclick = startCheckin;
  $('btnDone').onclick = () => {
    renderHome();
    // 성공했으면 그 학생의 도장판을 보여주고, 아니면 처음 화면으로
    if (lastOk && current) openMy(current); else show('screen-home');
  };

  $('btnBatchDone').onclick = () => { renderHome(); show('screen-home'); };
  $('btnMyBack').onclick = () => { renderHome(); show('screen-home'); };

  $('btnSaveCfg').onclick = saveConfig;
  $('btnTestModel').onclick = testModel;
  $('btnUseFolder').onclick = () => {
    $('cfgModelURL').value = 'model/';
    testModel();
  };
  $('btnTeacherBack').onclick = () => { renderHome(); show('screen-home'); };

  // 인식 기준 슬라이더를 움직이면 옆의 숫자가 따라갑니다
  $('cfgRecog').oninput = () => {
    $('cfgRecogVal').textContent = $('cfgRecog').value + '%';
  };

  $('btnExport').onclick = () => exportState(state);
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); };

  $('btnReset').onclick = () => {
    if (!confirm('모든 기록이 사라집니다. 정말 초기화할까요?')) return;
    if (!confirm('되돌릴 수 없어요. 내보내기로 백업했나요?')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  };

  // 다른 화면으로 갈 때 카메라가 켜져 있으면 끄기
  window.addEventListener('pagehide', stopCamera);
}

/* ---------- 출발! ---------- */
init();

# -*- coding: utf-8 -*-
"""
report.py  -  우유 출석 기록 분석하기

[왜 필요한가요?]
앱(선생님 설정 -> 기록 내보내기)을 누르면 '우유출석_2026-10-10.json'
같은 파일이 저장됩니다. 그 파일을 이 프로그램에 넣으면
  - 학생별 참여 현황 표 (CSV -> 엑셀로 열 수 있음)
  - 날짜별 참여 인원
  - 모델이 얼마나 잘 맞혔는지(성공률, 다시 찍은 횟수)
를 정리해 줍니다. 학급 경영 자료나 수업 자료로 쓸 수 있습니다.

[설치할 것] 없습니다. 파이썬만 있으면 됩니다.
            (표준 라이브러리 json, csv, datetime 만 사용)

------------------------------------------------------------------
[사용법]
  python tools/report.py 우유출석_2026-10-10.json

  파일 이름을 생략하면 폴더에서 가장 최근 json 을 찾아 씁니다.
  python tools/report.py

[결과]
  tools/out/학생별현황.csv
  tools/out/날짜별현황.csv
------------------------------------------------------------------
"""

import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

OUT_DIR = Path(__file__).parent / "out"


# ==================================================================
# 1. 파일 찾아서 읽기
# ==================================================================
def find_json():
    """명령줄에 파일을 주지 않았으면 가장 최근에 만든 json 을 찾습니다."""
    if len(sys.argv) > 1:
        return Path(sys.argv[1])

    # 현재 폴더와 상위 폴더에서 '우유출석*.json' 찾기
    here = Path(__file__).parent
    candidates = list(here.glob("*.json")) + list(here.parent.glob("*.json"))
    candidates = [p for p in candidates if "우유출석" in p.name]
    if not candidates:
        return None
    # st_mtime = 파일이 수정된 시각. 가장 큰(최근) 것을 고릅니다.
    return max(candidates, key=lambda p: p.stat().st_mtime)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ==================================================================
# 2. 학교 가는 날 계산 (JS의 streak.js 와 같은 규칙)
# ==================================================================
def school_days(start, end, skip_weekend, holidays):
    """
    start 부터 end 까지 '학교 가는 날' 목록을 만듭니다.
    토·일요일과 공휴일은 뺍니다.
    """
    days = []
    d = start
    while d <= end:
        iso = d.isoformat()
        is_weekend = d.weekday() >= 5          # 5=토, 6=일
        if not (skip_weekend and is_weekend) and iso not in holidays:
            days.append(iso)
        d += timedelta(days=1)
    return days


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


# ==================================================================
# 3. 학생별 현황 만들기
# ==================================================================
def student_table(data):
    cfg = data.get("config", {})
    records = data.get("records", {})
    roster = cfg.get("roster", [])
    goal = cfg.get("streakGoal", 5)
    skip_weekend = cfg.get("skipWeekend", True)
    holidays = set(cfg.get("holidays", []))

    # 전체 기간: 가장 먼저 먹은 날 ~ 오늘
    all_dates = [d for r in records.values() for d in r.get("dates", [])]
    if not all_dates:
        return [], []

    first = parse_date(min(all_dates))
    today = date.today()
    period = school_days(first, today, skip_weekend, holidays)
    total_days = len(period) or 1          # 0으로 나누는 것을 막기

    # 시도 기록(log)에서 학생별 성공/실패 횟수 세기
    tries = defaultdict(lambda: {"ok": 0, "fail": 0})
    for e in data.get("log", []):
        if e.get("practice"):              # 연습 모드는 통계에서 제외
            continue
        key = e.get("name", "?")
        tries[key]["ok" if e.get("ok") else "fail"] += 1

    rows = []
    for s in roster:
        name = s.get("name")
        r = records.get(name, {})
        dates = r.get("dates", [])
        t = tries[name]
        attempts = t["ok"] + t["fail"]

        rows.append({
            "이름": name,
            "참여일수": len(dates),
            "수업일수": total_days,
            "참여율(%)": round(len(dates) / total_days * 100, 1),
            "현재연속": r.get("streak", 0),
            "최고연속": r.get("best", 0),
            "받은쿠폰": r.get("coupons", 0),
            "남은쿠폰": r.get("coupons", 0) - r.get("couponsUsed", 0),
            "쿠폰까지남은일수": (goal - r.get("streak", 0) % goal) % goal,
            "촬영시도": attempts,
            "한번에성공률(%)": round(t["ok"] / attempts * 100, 1) if attempts else 0.0,
            "마지막참여": dates[-1] if dates else "-",
        })

    return rows, period


# ==================================================================
# 4. 날짜별 현황 만들기
# ==================================================================
def date_table(data, period):
    records = data.get("records", {})
    total_students = len(data.get("config", {}).get("roster", [])) or 1

    # 날짜 -> 그 날 먹은 학생 수
    count = Counter()
    for name, r in records.items():
        for d in r.get("dates", []):
            count[d] += 1

    rows = []
    weekday_kr = ["월", "화", "수", "목", "금", "토", "일"]
    for d in period:
        n = count.get(d, 0)
        rows.append({
            "날짜": d,
            "요일": weekday_kr[parse_date(d).weekday()],
            "참여인원": n,
            "전체인원": total_students,
            "참여율(%)": round(n / total_students * 100, 1),
        })
    return rows


# ==================================================================
# 5. CSV 로 저장하기
# ==================================================================
def save_csv(rows, filename):
    """
    엑셀에서 한글이 깨지지 않도록 'utf-8-sig' 로 저장합니다.
    (sig = 파일 맨 앞에 붙는 작은 표시. 엑셀이 이걸 보고 한글을 알아봅니다)
    """
    if not rows:
        return None
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / filename
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return path


# ==================================================================
# 6. 화면에 요약 출력
# ==================================================================
def print_summary(srows, drows, data):
    print("=" * 60)
    print(f" {data.get('config', {}).get('className', '우리 반')} 우유 출석 현황")
    print("=" * 60)

    if not srows:
        print("아직 기록이 없습니다.")
        return

    # 이름 칸 너비를 가장 긴 이름에 맞춤
    w = max(len(r["이름"]) for r in srows) + 2

    print(f"{'이름':<{w}}{'참여':>6}{'참여율':>8}{'연속':>6}{'쿠폰':>6}")
    print("-" * 60)
    for r in sorted(srows, key=lambda x: -x["참여일수"]):
        print(f"{r['이름']:<{w}}"
              f"{r['참여일수']:>4}일"
              f"{r['참여율(%)']:>7}%"
              f"{r['현재연속']:>5}일"
              f"{r['남은쿠폰']:>5}장")

    print("-" * 60)
    avg = sum(r["참여율(%)"] for r in srows) / len(srows)
    print(f"반 평균 참여율 : {avg:.1f}%")

    # 모델이 얼마나 잘 맞혔는지 (수업 자료로 쓰기 좋은 숫자입니다)
    logs = [e for e in data.get("log", []) if not e.get("practice")]
    if logs:
        ok = sum(1 for e in logs if e.get("ok"))
        print(f"촬영 시도      : {len(logs)}회 (성공 {ok}회, 성공률 {ok/len(logs)*100:.1f}%)")

        # 실패 이유별 집계 -> 모델을 더 학습시켜야 할지 판단
        reasons = Counter(e.get("reason") for e in logs if not e.get("ok"))
        name_kr = {
            "other": "다른 친구로 인식",
            "lowconf": "확신 부족(흐림/어두움)",
            "unsure": "1·2위 차이 작음",
            "error": "오류",
        }
        for k, v in reasons.most_common():
            print(f"  - {name_kr.get(k, k)}: {v}회")

    # 가장 참여율이 높은 날
    if drows:
        best = max(drows, key=lambda x: x["참여인원"])
        print(f"가장 많이 먹은 날: {best['날짜']}({best['요일']}) "
              f"{best['참여인원']}명")

    # 오늘 아직 안 먹은 학생
    today = date.today().isoformat()
    not_yet = [r["이름"] for r in srows if r["마지막참여"] != today]
    if not_yet:
        print(f"오늘 아직 안 한 학생({len(not_yet)}명): {', '.join(not_yet)}")


def main():
    path = find_json()
    if path is None or not path.exists():
        print("기록 파일(json)을 찾지 못했습니다.")
        print("앱의 [선생님 설정] -> [기록 내보내기]로 파일을 받은 뒤,")
        print("이 폴더에 넣고 다시 실행하거나 파일 경로를 적어주세요.")
        print("  예) python tools/report.py 우유출석_2026-10-10.json")
        return

    print(f"읽는 파일: {path.name}\n")
    data = load(path)

    srows, period = student_table(data)
    drows = date_table(data, period)

    print_summary(srows, drows, data)

    p1 = save_csv(srows, "학생별현황.csv")
    p2 = save_csv(drows, "날짜별현황.csv")
    if p1:
        print(f"\n저장: {p1}")
        print(f"저장: {p2}")
        print("엑셀로 바로 열 수 있습니다.")


if __name__ == "__main__":
    main()

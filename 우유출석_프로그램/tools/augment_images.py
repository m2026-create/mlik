# -*- coding: utf-8 -*-
"""
augment_images.py  -  티처블 머신 학습 사진 늘리기(데이터 증강)

[왜 필요한가요?]
티처블 머신은 사진이 많을수록 잘 맞힙니다. 그런데 쉬는 시간에
학생 한 명당 사진 50장을 찍는 건 힘들죠.
그래서 "5~10장만 찍어두고, 컴퓨터가 그것을 조금씩 바꿔서
50~100장으로 불려주는" 것이 데이터 증강(augmentation)입니다.

조금씩 바꾸는 방법
  - 살짝 회전     : 우유갑을 비뚤게 들었을 때를 대비
  - 밝기 변화     : 창가 / 교실 안쪽 조명 차이를 대비
  - 대비 변화     : 사진이 흐릿하거나 진할 때를 대비
  - 살짝 확대/이동: 카메라와의 거리가 달라질 때를 대비
  - 약한 흐림     : 손이 흔들렸을 때를 대비

[주의] 좌우 뒤집기(flip)는 절대 하지 않습니다.
       글씨를 좌우로 뒤집으면 그건 더 이상 그 학생의 글씨가 아니니까요.

------------------------------------------------------------------
[사용법]
1) 파이썬에 Pillow 설치
     pip install Pillow

2) 아래처럼 폴더를 만들고 원본 사진을 넣습니다.
     tools/raw/김하준/   <- 김하준이 쓴 우유갑 사진 5~10장
     tools/raw/이서아/
     tools/raw/박도윤/

3) 실행
     python tools/augment_images.py

4) 결과가 tools/out/ 에 만들어집니다.
     tools/out/김하준/  <- 늘어난 사진들
   티처블 머신에서 클래스를 만들고 [업로드]로 이 폴더 사진을 넣으세요.
------------------------------------------------------------------
"""

import random
from pathlib import Path

# Pillow(PIL)는 파이썬에서 사진을 다루는 도구입니다.
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

# ==================================================================
# 설정 - 이 숫자들만 바꾸면 결과가 달라집니다
# ==================================================================
RAW_DIR = Path(__file__).parent / "raw"    # 원본 사진이 있는 곳
OUT_DIR = Path(__file__).parent / "out"    # 결과를 저장할 곳

PER_IMAGE = 12        # 원본 1장을 몇 장으로 늘릴까?
IMG_SIZE = 224        # 티처블 머신이 쓰는 크기(224x224 정사각형)
SEED = 20261010       # 똑같은 결과를 다시 얻고 싶을 때 쓰는 씨앗값

ROTATE_MAX = 8        # 회전 최대 각도(도)
BRIGHT_RANGE = (0.75, 1.30)   # 밝기 배율 (1.0 = 원본)
CONTRAST_RANGE = (0.80, 1.25) # 대비 배율
ZOOM_RANGE = (1.00, 1.14)     # 확대 배율
BLUR_CHANCE = 0.25            # 흐리게 만들 확률 (25%)

# 읽어들일 사진 확장자
EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ==================================================================
# 1단계 : 정사각형으로 자르기
# ==================================================================
def to_square(img):
    """
    사진의 가운데를 정사각형으로 잘라 224x224로 만듭니다.
    앱(app.js)에서도 똑같이 '가운데 정사각형'으로 잘라 넣기 때문에,
    학습할 때와 사용할 때의 조건을 맞춰주는 것이 중요합니다.
    """
    w, h = img.size
    side = min(w, h)                 # 짧은 변 길이
    left = (w - side) // 2           # 가운데 기준 좌표
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    return img.resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)


# ==================================================================
# 2단계 : 사진 하나를 조금 바꾸기
# ==================================================================
def augment_once(img, rng):
    """
    원본 사진 한 장을 받아서 '조금 다른' 사진 한 장을 돌려줍니다.
    rng 는 난수 생성기입니다(random 모듈의 객체).
    """
    out = img

    # (1) 살짝 회전 - 빈 곳은 흰색으로 채웁니다(우유갑 배경과 비슷하게)
    angle = rng.uniform(-ROTATE_MAX, ROTATE_MAX)
    out = out.rotate(angle, resample=Image.BICUBIC, fillcolor=(255, 255, 255))

    # (2) 살짝 확대 후 가운데를 다시 잘라내기 -> '가까이서 찍은 느낌'
    zoom = rng.uniform(*ZOOM_RANGE)
    if zoom > 1.001:
        nw, nh = int(IMG_SIZE * zoom), int(IMG_SIZE * zoom)
        big = out.resize((nw, nh), Image.LANCZOS)
        # 가운데에서 조금 흔들린 위치를 고름 -> 위치가 조금씩 다른 효과
        max_off = (nw - IMG_SIZE) // 2
        ox = (nw - IMG_SIZE) // 2 + rng.randint(-max_off, max_off)
        oy = (nh - IMG_SIZE) // 2 + rng.randint(-max_off, max_off)
        out = big.crop((ox, oy, ox + IMG_SIZE, oy + IMG_SIZE))

    # (3) 밝기 바꾸기
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(*BRIGHT_RANGE))

    # (4) 대비 바꾸기
    out = ImageEnhance.Contrast(out).enhance(rng.uniform(*CONTRAST_RANGE))

    # (5) 가끔 살짝 흐리게 (손이 흔들린 느낌)
    if rng.random() < BLUR_CHANCE:
        out = out.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.3, 0.9)))

    return out


# ==================================================================
# 3단계 : 폴더 전체를 처리하기
# ==================================================================
def process_student(student_dir, rng):
    """
    학생 한 명의 폴더(tools/raw/김하준)를 처리합니다.
    돌려주는 값: (원본 장수, 만들어진 장수)
    """
    name = student_dir.name
    out_dir = OUT_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)

    # 폴더 안의 사진 파일만 모으기
    files = sorted(p for p in student_dir.iterdir()
                   if p.suffix.lower() in EXTS)
    if not files:
        print(f"  [건너뜀] {name}: 사진이 없어요")
        return 0, 0

    made = 0
    for idx, path in enumerate(files):
        try:
            # ImageOps.exif_transpose : 휴대폰으로 찍은 사진이
            # 옆으로 누워 보이는 문제를 바로잡아 줍니다.
            img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        except Exception as e:
            print(f"  [오류] {path.name}: {e}")
            continue

        base = to_square(img)

        # 원본(정사각형으로 자른 것)도 함께 저장
        base.save(out_dir / f"{name}_{idx:02d}_000.jpg", quality=92)
        made += 1

        # 조금씩 바꾼 사진들 저장
        for k in range(1, PER_IMAGE + 1):
            augment_once(base, rng).save(
                out_dir / f"{name}_{idx:02d}_{k:03d}.jpg", quality=92
            )
            made += 1

    print(f"  {name}: 원본 {len(files)}장 -> 결과 {made}장")
    return len(files), made


def main():
    print("=" * 56)
    print(" 우유갑 손글씨 사진 늘리기")
    print("=" * 56)

    if not RAW_DIR.exists():
        # 폴더가 없으면 만들어주고 안내만 합니다
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print(f"'{RAW_DIR}' 폴더를 만들었습니다.")
        print("이 안에 학생 이름으로 폴더를 만들고 사진을 넣은 뒤 다시 실행하세요.")
        print("  예) tools/raw/김하준/  tools/raw/이서아/")
        return

    # 난수에 씨앗을 심으면 몇 번 실행해도 같은 결과가 나옵니다
    rng = random.Random(SEED)

    students = sorted(p for p in RAW_DIR.iterdir() if p.is_dir())
    if not students:
        print("학생 폴더가 없습니다. tools/raw/ 안에 이름 폴더를 만들어주세요.")
        return

    total_raw = total_made = 0
    for s in students:
        raw, made = process_student(s, rng)
        total_raw += raw
        total_made += made

    print("-" * 56)
    print(f"전체: 원본 {total_raw}장 -> 학습용 {total_made}장")
    print(f"결과 위치: {OUT_DIR}")
    print()
    print("[다음 할 일]")
    print("1. teachablemachine.withgoogle.com 접속 -> 이미지 프로젝트")
    print("2. 클래스 이름을 '학생 이름'과 똑같이 만들기 (예: 김하준)")
    print("3. 각 클래스에 [업로드] -> tools/out/학생이름/ 사진 전부 넣기")
    print("4. '우유갑아님' 클래스도 하나 만들어 빈 책상/손/다른 물건 사진 넣기")
    print("   (-> 아무거나 찍어도 통과되는 일을 막아줍니다)")
    print("5. [모델 학습시키기] -> [모델 내보내기] -> [업로드]로 주소 받기")
    print("6. 앱의 선생님 설정에 그 주소 붙여넣기")


# 이 파일을 직접 실행했을 때만 main() 이 돌아갑니다.
if __name__ == "__main__":
    main()

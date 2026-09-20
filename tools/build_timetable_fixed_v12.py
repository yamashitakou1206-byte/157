#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
build_timetable_fixed_v12.py

名鉄公式「路線別時刻表」PDFを表（table）単位で解析するパーサー。

v12 の主な変更
- build 12-through-merge-4: 種別ヘッダー欠落時も座標候補で解析を継続
- 文字の「近さ」だけで時刻を拾わず、PDFの表セル/列を優先して解析
- 列車番号の列を固定し、種別・行先・駅時刻を同じ列から取得
- 左右どちらに駅名欄があるPDFにも対応
- 複数の表/パネルを別々に解析して、隣パネルへの侵入を防止
- 種別不明を「普通」にしない
- 駅名をセル全体から復元し、文字欠落を起こしにくくする
- 時刻逆行を検出。ただし 23時台→24時台/0時台など深夜跨ぎは許可
- 「レ」（通過）を保持
- PDF跨ぎは、同一運転日・同一列車番号・接続駅/重複区間・時刻連続性を照合して全列車を安全に連鎖結合
- 特定列車番号（299等）のハードコードなし

必要:
    pip install pdfplumber

入力:
    data/pdfs/*.pdf

出力:
    data/timetables.json
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Optional

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "data" / "pdfs"
OUTPUT = ROOT / "data" / "timetables.json"

MIN_TRAIN_COUNT = 1000

VALID_TYPES = {
    "普通",
    "準急",
    "急行",
    "快速急行",
    "特急",
    "快速特急",
    "ミュースカイ",
}

TYPE_ALIASES = {
    "普通": "普通",
    "準急": "準急",
    "急行": "急行",
    "快急": "快速急行",
    "快速急行": "快速急行",
    "特急": "特急",
    "快特": "快速特急",
    "快速特急": "快速特急",
    "μS": "ミュースカイ",
    "μＳ": "ミュースカイ",
    "μs": "ミュースカイ",
    "ミュースカイ": "ミュースカイ",
}

HEADER_TRAIN = ("列車番号", "列車番", "列番")
HEADER_TYPE = ("種別",)
HEADER_DEST = ("行先", "行き先")

SKIP_LABELS = {
    "", "駅名", "記事", "終着", "終", "着", "次のページ",
    "列車番号", "種別", "行先", "行き先",
}

TRAIN_RE = re.compile(r"^\d{1,5}[A-Za-z]?$")
TIME_RE = re.compile(r"^(?:[0-2]?\d)[:：]?[0-5]\d$")
TIME4_RE = re.compile(r"^([0-2]?\d)([0-5]\d)$")


def clean(value: Any) -> str:
    if value is None:
        return ""
    s = str(value)
    s = s.replace("\u3000", "")
    s = s.replace("\xa0", "")
    s = s.replace("\n", "")
    s = s.replace("\r", "")
    s = s.replace(" ", "")
    s = s.replace("　", "")
    s = s.replace("：", ":")
    return s.strip()


def clean_station(value: Any) -> str:
    """駅名はセル全体を使う。PDF抽出由来の改行・空白だけ除去する。"""
    s = clean(value)
    s = re.sub(r"^[・･●○◎◇◆]+", "", s)
    s = re.sub(r"[・･●○◎◇◆]+$", "", s)
    return s.strip()


def _dedupe_pdf_overlay_text(s: str) -> str:
    """Bold/overprint glyphs in official PDFs can be extracted twice.

    Examples observed in the supplied PDFs:
      特特急急 -> 特急, μμＳＳ -> μＳ, 553322 -> 532, 529529 -> 529
    Only collapse when the whole token has a clear duplicate structure.
    """
    if not s:
        return s
    n = len(s)
    # Whole token repeated twice: 529529 -> 529
    if n % 2 == 0 and s[: n // 2] == s[n // 2 :]:
        return s[: n // 2]
    # Every glyph doubled: 特特急急 -> 特急 / 553322 -> 532
    if n % 2 == 0 and all(s[i] == s[i + 1] for i in range(0, n, 2)):
        return "".join(s[i] for i in range(0, n, 2))
    return s


def normalize_type(value: Any) -> str:
    s = clean(value)
    if not s:
        return ""

    # PDFでは μＳ が「μ」「Ｓ」へ分割されたり、全角/半角・英字表記が混在する。
    s = (s.replace("µ", "μ").replace("Μ", "μ")
           .replace("Ｓ", "S").replace("ｓ", "s"))
    s = _dedupe_pdf_overlay_text(s)
    compact = re.sub(r"[^一-龥ぁ-んァ-ヶA-Za-zμ]", "", s)

    for key in ("快速特急", "ミュースカイ", "快速急行", "快特", "特急", "準急", "急行", "普通", "μS", "μs", "快急"):
        if key in compact:
            return TYPE_ALIASES.get(key, TYPE_ALIASES.get(key.replace("S", "Ｓ"), ""))
    return ""


def normalize_train_number(value: Any) -> str:
    s = clean(value)
    s = s.replace("Ｏ", "0").replace("O", "0")
    s = s.replace("Ｉ", "I")
    m = re.search(r"(\d{1,5}[A-Za-z]?)", s)
    return m.group(1) if m else ""


def normalize_time(value: Any) -> Optional[str]:
    """
    PDFの 854 / 0854 / 8:54 / 2400 等を HH:MM にする。
    25時以降は採用しない。
    """
    s = clean(value)
    if not s:
        return None

    # 名鉄PDFの太字/重ね描画は、pdfplumberで 529529 / 553322 のように
    # 二重抽出されることがある。時刻判定の前に安全な重複だけ戻す。
    s = _dedupe_pdf_overlay_text(s)

    # セルに「1409レ」のように混ざるケースでは時刻部分だけ取る。
    m = re.search(r"(?<!\d)([0-2]?\d)[:：]([0-5]\d)(?!\d)", s)
    if m:
        h = int(m.group(1))
        minute = int(m.group(2))
        if 0 <= h <= 24 and 0 <= minute <= 59:
            return f"{h:02d}:{minute:02d}"

    # 3～4桁の時刻。長い数字列の一部を誤取得しない。
    m = re.search(r"(?<!\d)(\d{3,4})(?!\d)", s)
    if not m:
        return None

    digits = m.group(1)
    if len(digits) == 3:
        h = int(digits[0])
        minute = int(digits[1:])
    else:
        h = int(digits[:2])
        minute = int(digits[2:])

    if not (0 <= h <= 24 and 0 <= minute <= 59):
        return None

    if h == 24 and minute > 59:
        return None

    return f"{h:02d}:{minute:02d}"


def is_pass(value: Any) -> bool:
    s = clean(value)
    if not s:
        return False
    # 「1409レ」のようなセルは時刻を優先し、単独のレだけ通過扱い。
    return s in {"レ", "ﾚ"}


def time_minutes(value: str) -> int:
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def chronological(stops: list[dict[str, Any]]) -> bool:
    """
    停車/通過時刻の並びを検査。
    同時刻は許可。24:xxも許可。
    23時台→00時台のような深夜跨ぎも許可。
    """
    previous: Optional[int] = None
    offset = 0

    for stop in stops:
        t = stop.get("time")
        if not t:
            continue

        value = time_minutes(t)

        # 24:xx はそのまま翌日側
        if value >= 1440:
            value += offset
        else:
            value += offset

        if previous is not None and value < previous:
            # 22/23/24時台から0～2時台への日跨ぎだけ許容
            prev_clock = previous % 1440
            curr_clock = value % 1440
            if prev_clock >= 20 * 60 and curr_clock <= 3 * 60:
                offset += 1440
                value += 1440
            else:
                return False

        previous = value

    return True


TIMETABLE_GROUP_CODES = [
    "NH", "TK", "GN", "MY", "MU", "TT", "TA", "CH",
    "ST", "TB", "BS", "IY", "HM", "KM", "TH",
]

def canonical_pdf_code(name: str) -> str:
    """
    sources.json に filename が無く timetable_01.pdf のように保存された場合でも、
    60本の公式PDFの並び（各線 W1,H1,W2,H2）から元コードを復元する。
    NH_W1.pdf 等の名前ならそのまま返す。
    """
    upper = Path(name).name.upper()
    m = re.search(r"(?:^|_)([A-Z]{2})_(W|H)([12])(?:_|\.|$)", upper)
    if m:
        return f"{m.group(1)}_{m.group(2)}{m.group(3)}"
    m = re.fullmatch(r"TIMETABLE_(\d{2})\.PDF", upper)
    if not m:
        return ""
    idx = int(m.group(1)) - 1
    if idx < 0 or idx >= len(TIMETABLE_GROUP_CODES) * 4:
        return ""
    group = TIMETABLE_GROUP_CODES[idx // 4]
    suffix = ("W1", "H1", "W2", "H2")[idx % 4]
    return f"{group}_{suffix}"


def day_type_from_filename(name: str) -> str:
    upper = canonical_pdf_code(name) or name.upper()
    if "_W" in upper:
        return "weekday"
    if "_H" in upper:
        return "holiday"
    return "unknown"


def direction_from_filename(name: str) -> str:
    upper = canonical_pdf_code(name) or name.upper()
    m = re.search(r"_(?:W|H)([12])(?:_|\.|$)", upper)
    if not m:
        return ""
    return "down" if m.group(1) == "1" else "up"


ROUTE_CODES = {
    "NH": "名古屋本線",
    "TK": "豊川線",
    "GN": "西尾線・蒲郡線",
    "MY": "三河線",
    "MU": "三河線",
    "TT": "豊田線・地下鉄鶴舞線",
    "TA": "常滑線・空港線・河和線・知多新線",
    "CH": "築港線",
    "ST": "瀬戸線",
    "TB": "津島線",
    "BS": "尾西線",
    "IY": "犬山線・各務原線",
    "HM": "広見線",
    "KM": "小牧線・地下鉄上飯田線",
    "TH": "竹鼻線・羽島線",
}


def route_from_filename(name: str) -> str:
    upper = canonical_pdf_code(name) or name.upper()
    # 20260314_NH_W1_1.pdf / NH_W1.pdf の双方
    for code, route in ROUTE_CODES.items():
        if re.search(rf"(?:^|_){re.escape(code)}_(?:W|H)[12](?:_|\.|$)", upper):
            return route
    return ""


def crew_for_route(route: str) -> str:
    # 乗務区はPDFから確実に得られないため、誤情報を生成しない。
    # UI側で必要なら別の正式データを重ねる。
    return ""


def row_text(row: list[Any]) -> str:
    return "".join(clean(x) for x in row)


def contains_header(row: list[Any], headers: Iterable[str]) -> bool:
    text = row_text(row)
    return any(h in text for h in headers)


def trim_row(row: list[Any], width: int) -> list[str]:
    vals = [clean(x) for x in row]
    if len(vals) < width:
        vals += [""] * (width - len(vals))
    return vals[:width]


def find_header_index(rows: list[list[str]], headers: Iterable[str], start: int = 0) -> Optional[int]:
    for i in range(start, len(rows)):
        if contains_header(rows[i], headers):
            return i
    return None


def score_station_column(rows: list[list[str]], col: int, body_start: int) -> int:
    score = 0
    for row in rows[body_start:]:
        if col >= len(row):
            continue
        s = clean_station(row[col])
        if not s or s in SKIP_LABELS:
            continue
        if normalize_time(s) is not None:
            continue
        if is_pass(s):
            continue
        if normalize_type(s):
            continue
        if TRAIN_RE.fullmatch(s):
            continue
        # 駅名は通常日本語を含む
        if re.search(r"[一-龥々ヶケぁ-んァ-ヶ]", s):
            score += 1
    return score


def choose_station_column(rows: list[list[str]], body_start: int, width: int) -> Optional[int]:
    """
    名鉄PDFは駅名欄が表の左端または右端にある。
    端から最大3列だけを候補にして、列車時刻列を駅名と誤認しない。
    """
    candidates = list(range(min(3, width)))
    candidates += list(range(max(0, width - 3), width))
    candidates = sorted(set(candidates))

    scored = [(score_station_column(rows, c, body_start), c) for c in candidates]
    scored.sort(reverse=True)

    if not scored or scored[0][0] < 2:
        return None
    return scored[0][1]


def train_columns_from_header(row: list[str], station_col: int) -> dict[int, str]:
    result: dict[int, str] = {}
    for c, value in enumerate(row):
        if c == station_col:
            continue
        n = normalize_train_number(value)
        if n and TRAIN_RE.fullmatch(n):
            result[c] = n
    return result


def get_cell(row: list[str], col: int) -> str:
    return row[col] if 0 <= col < len(row) else ""


def _word_text(word: dict[str, Any]) -> str:
    return clean(word.get("text", ""))


def _cluster_words_by_line(words: list[dict[str, Any]], tolerance: float = 3.0) -> list[list[dict[str, Any]]]:
    lines: list[list[dict[str, Any]]] = []
    for w in sorted(words, key=lambda x: (float(x.get("top", 0)), float(x.get("x0", 0)))):
        top = float(w.get("top", 0))
        target = None
        for line in lines:
            if abs(float(line[0].get("top", 0)) - top) <= tolerance:
                target = line
                break
        if target is None:
            target = []
            lines.append(target)
        target.append(w)
    for line in lines:
        line.sort(key=lambda x: float(x.get("x0", 0)))
    return lines


def _word_cx(word: dict[str, Any]) -> float:
    return (float(word.get("x0", 0)) + float(word.get("x1", 0))) / 2.0


def _word_cy(word: dict[str, Any]) -> float:
    return (float(word.get("top", 0)) + float(word.get("bottom", word.get("top", 0)))) / 2.0


def coordinate_type_candidates(page) -> list[dict[str, Any]]:
    """表抽出で種別セルが崩れた時の座標ベース保険。

    列車番号だけを辞書キーにせず、同一ページに同じ列車番号が複数あっても
    候補を別々に保持する。μ と S/Ｓ が別wordの場合も結合して判定する。
    """
    try:
        words = page.extract_words(
            x_tolerance=1.5,
            y_tolerance=2,
            keep_blank_chars=False,
            use_text_flow=False,
        ) or []
        # Some official PDFs contain translated duplicate text objects outside the
        # MediaBox. They are not visible on the page and must not participate in
        # column matching.
        words = [w for w in words
                 if float(w.get("x1", 0)) >= 0
                 and float(w.get("x0", 0)) <= float(page.width)
                 and float(w.get("bottom", 0)) >= 0
                 and float(w.get("top", 0)) <= float(page.height)]
    except Exception:
        return []

    lines = _cluster_words_by_line(words, tolerance=3.0)
    result: list[dict[str, Any]] = []

    for li, line in enumerate(lines):
        for w in line:
            raw = _word_text(w)
            num = normalize_train_number(raw)
            if not num or not TRAIN_RE.fullmatch(num):
                continue

            # 「854」等の時刻を列車番号と誤認しにくくする。
            if normalize_time(raw) is not None and len(re.sub(r"\\D", "", raw)) in (3, 4):
                continue

            train_x = _word_cx(w)
            train_y = _word_cy(w)
            candidates: list[tuple[float, str, float]] = []

            # 種別は通常、列車番号より下側。同一X列を強く優先する。
            for lj in range(li + 1, min(len(lines), li + 10)):
                near = [ww for ww in lines[lj] if abs(_word_cx(ww) - train_x) <= 26]
                if not near:
                    continue
                near.sort(key=lambda z: float(z.get("x0", 0)))

                texts = [_word_text(z) for z in near]
                joined = "".join(texts)
                variants = texts + [joined]

                # μ / µ と S / Ｓ が別々に抽出されるPDFに対応。
                glyphs = (joined.replace("µ", "μ").replace("Μ", "μ")
                                .replace("Ｓ", "S").replace("ｓ", "s"))
                if "μ" in glyphs and ("S" in glyphs or "s" in glyphs):
                    variants.insert(0, "μS")

                typ = ""
                for value in variants:
                    typ = normalize_type(value)
                    if typ:
                        break
                if not typ:
                    continue

                xdist = min(abs(_word_cx(z) - train_x) for z in near)
                ydist = max(0.0, _word_cy(near[0]) - train_y)
                score = xdist + ydist * 0.12
                candidates.append((score, typ, _word_cx(near[0])))

            if candidates:
                candidates.sort(key=lambda x: x[0])
                score, typ, type_x = candidates[0]
                result.append({
                    "trainNumber": num,
                    "trainX": train_x,
                    "type": typ,
                    "typeX": type_x,
                    "score": score,
                })

    return result


def coordinate_type_for_train(
    candidates: list[dict[str, Any]],
    train_number: str,
) -> str:
    """同じ列車番号の候補を上書きせず、最も強い座標候補を返す。"""
    matches = [c for c in candidates if c.get("trainNumber") == train_number]
    if not matches:
        return ""
    matches.sort(key=lambda c: float(c.get("score", 999999)))
    return str(matches[0].get("type", "") or "")

def parse_table(
    raw_table: list[list[Any]],
    *,
    pdf_name: str,
    page_number: int,
    table_number: int,
    type_fallback: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    if not raw_table:
        return []

    width = max((len(r) for r in raw_table if r), default=0)
    if width < 3:
        return []

    rows = [trim_row(r or [], width) for r in raw_table]

    # 1つの抽出table内に複数ヘッダが連結される場合もあるので、
    # 「列車番号」行ごとにブロック分割する。
    train_headers = [
        i for i, row in enumerate(rows)
        if contains_header(row, HEADER_TRAIN)
    ]
    if not train_headers:
        return []

    trains: list[dict[str, Any]] = []

    for block_no, header_i in enumerate(train_headers):
        block_end = train_headers[block_no + 1] if block_no + 1 < len(train_headers) else len(rows)
        block = rows[header_i:block_end]
        if len(block) < 4:
            continue

        type_rel = find_header_index(block, HEADER_TYPE, 1)
        dest_rel = find_header_index(block, HEADER_DEST, 1)

        # 種別ヘッダーが表抽出で欠落しても、ブロック全体は捨てない。
        # 行先など残っているメタデータ行の直後から駅行を探索する。
        metadata_rows = [x for x in (type_rel, dest_rel) if x is not None]
        if metadata_rows:
            body_start = max(metadata_rows) + 1
        else:
            body_start = min(3, len(block) - 1)
        station_col = choose_station_column(block, body_start, width)
        if station_col is None:
            continue

        columns = train_columns_from_header(block[0], station_col)
        if not columns:
            continue

        type_row = block[type_rel] if type_rel is not None else [""] * width
        dest_row = block[dest_rel] if dest_rel is not None else [""] * width

        route = route_from_filename(pdf_name)
        day_type = day_type_from_filename(pdf_name)
        direction = direction_from_filename(pdf_name)

        for col, train_number in columns.items():
            train_type = normalize_type(get_cell(type_row, col))
            if not train_type and type_rel is not None:
                # PDFによっては種別文字がセル境界の都合で上下の行へ分割される。
                # 同じ列だけを維持したまま、種別行の前後2行を確認する。
                for rr in range(max(0, type_rel - 2), min(len(block), type_rel + 3)):
                    train_type = normalize_type(get_cell(block[rr], col))
                    if train_type:
                        break
            if not train_type and type_fallback:
                train_type = coordinate_type_for_train(type_fallback, train_number)
            if not train_type:
                continue

            destination = clean_station(get_cell(dest_row, col))
            if destination in SKIP_LABELS:
                destination = ""

            stops: list[dict[str, Any]] = []
            last_station = ""

            for row in block[body_start:]:
                station = clean_station(get_cell(row, station_col))
                cell = get_cell(row, col)

                # 表末尾・記事行を除外
                if not station or station in SKIP_LABELS:
                    continue
                if station.startswith("次のページ"):
                    continue
                if "記事" == station:
                    continue

                # 駅名欄に日本語が無い場合は注記等とみなす
                if not re.search(r"[一-龥々ヶケぁ-んァ-ヶ]", station):
                    continue

                t = normalize_time(cell)
                passed = is_pass(cell)

                # … や空欄は、その列車がこの駅を走らない/この表では対象外
                if t is None and not passed:
                    continue

                # 同じ駅名が「着」「発」の2行に分かれているPDFでは、
                # 同駅の時刻を arrival/departure としてまとめる。
                if stops and station == last_station:
                    if t:
                        if not stops[-1].get("arrival"):
                            stops[-1]["arrival"] = stops[-1].get("time") or t
                        stops[-1]["departure"] = t
                        stops[-1]["time"] = t
                    continue

                stop: dict[str, Any] = {
                    "station": station,
                    "time": t,
                    "pass": bool(passed),
                }

                if t:
                    stop["departure"] = t

                stops.append(stop)
                last_station = station

            # 通過「レ」だけでは時計順を検証できない。
            timed = [s for s in stops if s.get("time")]
            if len(timed) < 2:
                continue

            # 同一列の中で時刻が逆行するなら、別パネル混入等として不採用。
            if not chronological(stops):
                continue

            identity_obj = {
                "dayType": day_type,
                "trainNumber": train_number,
                "source": pdf_name,
                "page": page_number,
                "table": table_number,
                "column": col,
                "stops": stops,
            }
            identity = json.dumps(identity_obj, ensure_ascii=False, separators=(",", ":"))
            train_id = hashlib.sha1(identity.encode("utf-8")).hexdigest()

            trains.append({
                "id": train_id,
                "dayType": day_type,
                "trainNumber": train_number,
                "type": train_type,
                "destination": destination,
                "route": route,
                "direction": direction,
                "crew": crew_for_route(route),
                "stops": stops,
                "_source": {
                    "pdf": pdf_name,
                    "page": page_number,
                    "table": table_number,
                    "column": col,
                },
            })

    return trains


TABLE_SETTINGS = [
    # 線が引かれた表を最優先
    {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "intersection_tolerance": 5,
        "text_tolerance": 2,
    },
    # 一部ページで罫線抽出が弱い場合のフォールバック
    {
        "vertical_strategy": "text",
        "horizontal_strategy": "text",
        "min_words_vertical": 2,
        "min_words_horizontal": 1,
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "intersection_tolerance": 5,
        "text_tolerance": 2,
    },
]


def table_signature(table: list[list[Any]]) -> str:
    normalized = [[clean(c) for c in (row or [])] for row in table]
    return hashlib.sha1(
        json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def extract_page_tables(page) -> list[list[list[Any]]]:
    """
    同一ページを複数設定で抽出するが、同じ表は重複させない。
    lines方式で十分取れた場合はtext方式の重複を抑える。
    """
    collected: list[list[list[Any]]] = []
    seen: set[str] = set()

    for settings in TABLE_SETTINGS:
        try:
            tables = page.extract_tables(table_settings=settings) or []
        except Exception:
            tables = []

        for table in tables:
            if not table or len(table) < 3:
                continue
            sig = table_signature(table)
            if sig in seen:
                continue
            seen.add(sig)
            collected.append(table)

        # lines方式で一部だけ読めるページがあるため、ここでは打ち切らない。
        # text方式も必ず試し、後段のdedupeで重複を除去する。

    return collected


def parse_pdf(path: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    print(f"Parsing: {path.name}")

    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            type_fallback = coordinate_type_candidates(page)
            tables = extract_page_tables(page)
            page_count = 0

            for table_no, table in enumerate(tables, start=1):
                parsed = parse_table(
                    table,
                    pdf_name=path.name,
                    page_number=page_no,
                    table_number=table_no,
                    type_fallback=type_fallback,
                )
                result.extend(parsed)
                page_count += len(parsed)

            print(f"  page {page_no:>2}: {page_count:>4} trains")

    return result


def stop_key(stop: dict[str, Any]) -> tuple:
    return (
        stop.get("station", ""),
        stop.get("time"),
        bool(stop.get("pass")),
    )


def train_quality(t: dict[str, Any]) -> tuple:
    timed = sum(1 for s in t.get("stops", []) if s.get("time"))
    total = len(t.get("stops", []))
    has_dest = 1 if t.get("destination") else 0
    return (timed, total, has_dest)


def dedupe(trains: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    text/lines抽出や重複ページによる完全重複を除去。
    同じ列車番号でも経路が違うセグメントは残す。
    """
    best: dict[tuple, dict[str, Any]] = {}

    for t in trains:
        key = (
            t.get("dayType"),
            t.get("trainNumber"),
            tuple(stop_key(s) for s in t.get("stops", [])),
        )
        old = best.get(key)
        if old is None or train_quality(t) > train_quality(old):
            best[key] = t

    return list(best.values())


def _segment_sources(t: dict[str, Any]) -> list[dict[str, Any]]:
    sources = t.get("_sources")
    if isinstance(sources, list) and sources:
        return [s for s in sources if isinstance(s, dict)]
    src = t.get("_source")
    return [src] if isinstance(src, dict) and src else []


def _route_list(t: dict[str, Any]) -> list[str]:
    routes = t.get("routes")
    if isinstance(routes, list):
        return [str(x) for x in routes if x]
    route = str(t.get("route", "") or "")
    return [x for x in route.split("・") if x]


def _clock_gap(a: str, b: str) -> Optional[int]:
    """a→b の分差。深夜跨ぎだけ翌日補正する。"""
    ta = time_minutes(a)
    tb = time_minutes(b)
    gap = tb - ta
    if gap < 0 and ta >= 20 * 60 and tb <= 3 * 60:
        gap += 1440
    return gap


def _times_compatible(a: dict[str, Any], b: dict[str, Any], *, max_gap: int = 30) -> bool:
    """同じ接続駅として扱える時刻か。到着→発車の数分差も許容。"""
    ta = a.get("time")
    tb = b.get("time")
    if not ta or not tb:
        return True
    gap = _clock_gap(ta, tb)
    return gap is not None and 0 <= gap <= max_gap


def _best_overlap(a: dict[str, Any], b: dict[str, Any]) -> Optional[tuple[int, int]]:
    """
    a末尾とb先頭の重複駅を探す。
    戻り値は (重複駅数, 接続時刻差)。複数駅重複を最優先する。
    """
    astops = a.get("stops") or []
    bstops = b.get("stops") or []
    if not astops or not bstops:
        return None

    limit = min(len(astops), len(bstops), 12)
    for n in range(limit, 0, -1):
        aa = astops[-n:]
        bb = bstops[:n]
        if [x.get("station") for x in aa] != [x.get("station") for x in bb]:
            continue
        if all(_times_compatible(x, y) for x, y in zip(aa, bb)):
            ta = next((x.get("time") for x in reversed(aa) if x.get("time")), None)
            tb = next((x.get("time") for x in reversed(bb) if x.get("time")), None)
            gap = _clock_gap(ta, tb) if ta and tb else 0
            if gap is None or gap < 0 or gap > 30:
                gap = 0
            return n, gap
    return None


def _merge_same_station(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    out = dict(left)
    # 左側を到着、右側を発車として情報を残す。
    lt = left.get("time")
    rt = right.get("time")
    if lt and not out.get("arrival"):
        out["arrival"] = left.get("arrival") or lt
    if rt:
        out["departure"] = right.get("departure") or rt
        out["time"] = out["departure"]
    out["pass"] = bool(left.get("pass")) and bool(right.get("pass"))
    return out


def _combine_segments(a: dict[str, Any], b: dict[str, Any], overlap: int) -> Optional[dict[str, Any]]:
    astops = [dict(s) for s in (a.get("stops") or [])]
    bstops = [dict(s) for s in (b.get("stops") or [])]
    if not astops or not bstops or overlap < 1:
        return None

    combined_stops = astops[:-overlap]
    for left, right in zip(astops[-overlap:], bstops[:overlap]):
        combined_stops.append(_merge_same_station(left, right))
    combined_stops.extend(bstops[overlap:])

    # 連続した同一駅が残った場合だけ統合する。
    compact: list[dict[str, Any]] = []
    for stop in combined_stops:
        if compact and compact[-1].get("station") == stop.get("station"):
            compact[-1] = _merge_same_station(compact[-1], stop)
        else:
            compact.append(stop)
    combined_stops = compact

    if len(combined_stops) < 2 or not chronological(combined_stops):
        return None

    combined = dict(a)
    combined["stops"] = combined_stops
    combined["origin"] = combined_stops[0].get("station", "")
    combined["destination"] = b.get("destination") or combined_stops[-1].get("station", "") or a.get("destination", "")

    routes: list[str] = []
    for route in _route_list(a) + _route_list(b):
        if route and route not in routes:
            routes.append(route)
    combined["routes"] = routes
    combined["route"] = "・".join(routes)
    combined["crew"] = crew_for_route(combined["route"])

    # 種別変更は接続地点を記録する。重複は除去。
    changes: list[dict[str, str]] = []
    for change in list(a.get("typeChanges", [])):
        if change not in changes:
            changes.append(change)
    if b.get("type") and b.get("type") != a.get("type"):
        change = {"station": bstops[0].get("station", ""), "type": b["type"]}
        if change not in changes:
            changes.append(change)
    for change in list(b.get("typeChanges", [])):
        if change not in changes:
            changes.append(change)
    if changes:
        combined["typeChanges"] = changes

    sources: list[dict[str, Any]] = []
    for src in _segment_sources(a) + _segment_sources(b):
        if src and src not in sources:
            sources.append(src)
    combined["_sources"] = sources

    identity = json.dumps({
        "dayType": combined.get("dayType", "unknown"),
        "trainNumber": combined.get("trainNumber", ""),
        "stops": combined_stops,
    }, ensure_ascii=False, separators=(",", ":"))
    combined["id"] = hashlib.sha1(identity.encode("utf-8")).hexdigest()
    return combined


def merge_segments(trains: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    全列車を対象に、路線別PDFへ分割された直通列車を一本化する。

    結合条件:
      * dayType と列車番号が一致
      * a末尾とb先頭に1駅以上の共通区間がある
      * 共通駅の時刻が矛盾しない（接続駅の到着→発車は30分以内）
      * 同一表そのものの重複ではない
      * 結合後も時刻が正常に進む
      * 各セグメントの最良の後続候補が一意で、逆方向からも最良候補になる

    同じ列車番号だけを理由に結合しないため、別列車・別パネル混入を抑える。
    2区間に限定せず、結合できる限り繰り返すので3路線以上の直通にも対応する。
    """
    by_number: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for t in trains:
        by_number[(t.get("dayType", "unknown"), t.get("trainNumber", ""))].append(t)

    output: list[dict[str, Any]] = []
    merge_count = 0
    ambiguous_count = 0

    for _, group in by_number.items():
        segments = list(group)

        while True:
            edges: list[tuple[tuple[int, int, int, int], int, int, int]] = []
            # score: overlap多い > gap小さい > aが長い > bが長い
            for i, a in enumerate(segments):
                for j, b in enumerate(segments):
                    if i == j:
                        continue
                    sa = _segment_sources(a)
                    sb = _segment_sources(b)
                    if sa and sb and sa == sb:
                        continue
                    match = _best_overlap(a, b)
                    if not match:
                        continue
                    overlap, gap = match
                    score = (overlap, -gap, len(a.get("stops", [])), len(b.get("stops", [])))
                    edges.append((score, i, j, overlap))

            if not edges:
                break

            # 各aの最良後続と各bの最良前区間を求める。同点は曖昧として不採用。
            outgoing: dict[int, list[tuple]] = defaultdict(list)
            incoming: dict[int, list[tuple]] = defaultdict(list)
            for edge in edges:
                outgoing[edge[1]].append(edge)
                incoming[edge[2]].append(edge)

            def unique_best(items: list[tuple]) -> Optional[tuple]:
                items = sorted(items, key=lambda e: e[0], reverse=True)
                if not items:
                    return None
                if len(items) > 1 and items[0][0] == items[1][0]:
                    return None
                return items[0]

            mutual: list[tuple] = []
            for i, items in outgoing.items():
                best = unique_best(items)
                if not best:
                    if len(items) > 1:
                        ambiguous_count += 1
                    continue
                back = unique_best(incoming.get(best[2], []))
                if back and back[1] == best[1] and back[2] == best[2]:
                    mutual.append(best)

            if not mutual:
                break

            mutual.sort(key=lambda e: e[0], reverse=True)
            _, i, j, overlap = mutual[0]
            combined = _combine_segments(segments[i], segments[j], overlap)
            if combined is None:
                # このペアを再試行し続けないよう、今回はこのグループの結合を終了。
                break

            segments = [s for k, s in enumerate(segments) if k not in (i, j)] + [combined]
            merge_count += 1

        # 未結合列車にもorigin/routesを付与する。
        for t in segments:
            stops = t.get("stops") or []
            if stops:
                t.setdefault("origin", stops[0].get("station", ""))
                if not t.get("destination"):
                    t["destination"] = stops[-1].get("station", "")
            routes = _route_list(t)
            if routes:
                t["routes"] = routes
        output.extend(segments)

    print(f"Merged direct-through segments: {merge_count}")
    print(f"Ambiguous merge candidates skipped: {ambiguous_count}")
    return output

def validate_train(t: dict[str, Any]) -> bool:
    if not TRAIN_RE.fullmatch(str(t.get("trainNumber", ""))):
        return False
    if t.get("type") not in VALID_TYPES:
        return False
    stops = t.get("stops")
    if not isinstance(stops, list) or len(stops) < 2:
        return False
    if not chronological(stops):
        return False
    return True


def strip_private_fields(t: dict[str, Any]) -> dict[str, Any]:
    out = dict(t)
    out.pop("_source", None)
    out.pop("_sources", None)
    return out


def main() -> int:
    if not PDF_DIR.exists():
        print(f"ERROR: PDF directory not found: {PDF_DIR}", file=sys.stderr)
        return 1

    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"ERROR: no PDFs found in {PDF_DIR}", file=sys.stderr)
        return 1

    print("=" * 72)
    print("Meitetsu timetable parser v12")
    print(f"PDFs: {len(pdfs)}")
    print("=" * 72)

    all_trains: list[dict[str, Any]] = []

    for index, pdf in enumerate(pdfs, start=1):
        print(f"[{index}/{len(pdfs)}] {pdf.name}")
        try:
            parsed = parse_pdf(pdf)
        except Exception as exc:
            print(f"ERROR parsing {pdf.name}: {exc}", file=sys.stderr)
            raise
        print(f"  -> {len(parsed)} segments")
        all_trains.extend(parsed)

    print(f"Raw segments: {len(all_trains)}")

    all_trains = dedupe(all_trains)
    print(f"After dedupe: {len(all_trains)}")

    valid_before_merge = [t for t in all_trains if validate_train(t)]
    rejected = len(all_trains) - len(valid_before_merge)
    print(f"Rejected invalid segments: {rejected}")

    merged = merge_segments(valid_before_merge)
    merged = [t for t in merged if validate_train(t)]

    # 安定した並び
    merged.sort(
        key=lambda t: (
            t.get("dayType", ""),
            t.get("trainNumber", ""),
            (next((s.get("time") for s in t.get("stops", []) if s.get("time")), "") or ""),
            t.get("route", ""),
        )
    )

    type_counts = Counter(t.get("type", "") for t in merged)
    day_counts = Counter(t.get("dayType", "") for t in merged)

    print(f"Generated trains: {len(merged)}")
    print("Types:", json.dumps(dict(sorted(type_counts.items())), ensure_ascii=False))
    print("Day types:", json.dumps(dict(sorted(day_counts.items())), ensure_ascii=False))

    # 旧版のように欠落種別を「普通」に置換しない。
    # ただし全7種が必ず毎回存在する、と決め打ちしてビルドを落とすこともしない。
    # 現行公式PDFに実際に存在するものを正しく保存する。
    if len(merged) < MIN_TRAIN_COUNT:
        raise RuntimeError(
            f"解析列車数が少なすぎます: {len(merged)} "
            f"(minimum={MIN_TRAIN_COUNT})"
        )

    payload = {
        "version": 12,
        "build": "12-through-merge-4",
        "source": "Meitetsu official route timetable PDFs",
        "trainCount": len(merged),
        "types": dict(sorted(type_counts.items())),
        "dayTypes": dict(sorted(day_counts.items())),
        "trains": [strip_private_fields(t) for t in merged],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    temp = OUTPUT.with_suffix(".json.tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    # JSONが最後まで正常に生成された時だけ本番へ置換
    temp.replace(OUTPUT)

    print("=" * 72)
    print("SUCCESS")
    print(f"Output: {OUTPUT}")
    print(f"Size: {OUTPUT.stat().st_size:,} bytes")
    print("=" * 72)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

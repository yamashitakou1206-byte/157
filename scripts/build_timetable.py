import os, re, json, hashlib, tempfile
from datetime import datetime, timezone
import pdfplumber

PDF_DIR = "data/pdfs"
OUTPUT = "data/timetables.json"
MIN_TRAIN_COUNT = 10

ROUTES = [
    "名古屋本線","豊川線","津島線","尾西線","竹鼻線","羽島線",
    "常滑線","空港線","河和線","知多新線","犬山線","各務原線",
    "広見線","小牧線","三河線","豊田線","西尾線","蒲郡線","瀬戸線",
]

TYPE_MAP = {
    "普通": "普通",
    "準急": "準急",
    "急行": "急行",
    "快急": "快速急行",
    "快速急行": "快速急行",
    "特急": "特急",
    "快特": "快速特急",
    "快速特急": "快速特急",
    "μＳ": "ミュースカイ",
    "μS": "ミュースカイ",
    "μＳｋｙ": "ミュースカイ",
    "μμＳＳ": "ミュースカイ",
    "ミュースカイ": "ミュースカイ",
}

TRAIN_RE = re.compile(r"^\d{1,5}[A-Z]?$", re.I)
TIME_RE = re.compile(r"^(\d{1,2}):?(\d{2})$")

NOISE = {"発", "着", "〃", "上", "下", "り", "前", "の", "ペ", "ー", "ジ", "始", "終", "記事", "行", "先"}


def clean(s):
    return re.sub(r"\s+", " ", str(s or "").replace("\n", " ").replace("\r", " ")).strip()


def norm_time(s):
    s = clean(s).replace("：", ":")
    m = TIME_RE.fullmatch(s)
    if m:
        h, minute = int(m.group(1)), int(m.group(2))
    elif s.isdigit() and 3 <= len(s) <= 4:
        h, minute = int(s[:-2]), int(s[-2:])
    else:
        return ""
    if 0 <= h <= 29 and 0 <= minute <= 59:
        return f"{h}:{minute:02d}"
    return ""


def is_train_number(s):
    return bool(TRAIN_RE.fullmatch(clean(s)))


def group_words(words, tolerance=1.6):
    rows = []
    for w in sorted(words, key=lambda x: (x["top"], x["x0"])):
        if not rows or abs(w["top"] - rows[-1][0]) > tolerance:
            rows.append([w["top"], [w]])
        else:
            rows[-1][1].append(w)
    return rows


def crew_for_route(route):
    if any(x in route for x in ["名古屋本線","豊川線","津島線","尾西線","竹鼻線","羽島線"]):
        return "名古屋乗務区"
    if any(x in route for x in ["常滑線","空港線","河和線","知多新線"]):
        return "神宮前乗務区"
    if any(x in route for x in ["犬山線","各務原線","広見線","小牧線"]):
        return "犬山乗務区"
    if any(x in route for x in ["三河線","豊田線","西尾線","蒲郡線"]):
        return "知立乗務区"
    if "瀬戸線" in route:
        return "瀬戸運輸区"
    return ""


def route_from_text(text, filename):
    for route in ROUTES:
        if route in text or route in filename:
            return route
    return ""


def normalize_type(value):
    value = clean(value).replace(" ", "")
    # PDF text extraction can duplicate glyphs.
    if "μ" in value and "Ｓ" in value:
        return "ミュースカイ"
    return TYPE_MAP.get(value, "")


def normalize_destination(words):
    parts = []
    for w in sorted(words, key=lambda x: (x["top"], x["x0"])):
        t = clean(w["text"])
        if not t or t in NOISE or t in TYPE_MAP or norm_time(t):
            continue
        if re.fullmatch(r"[.・…=└─]+", t):
            continue
        if re.fullmatch(r"\d+[A-Z]?", t, re.I):
            continue
        parts.append(t)
    text = "".join(parts)
    replacements = [
        ("中中部部国国際際空空港港", "中部国際空港"),
        ("中中部部国国", "中部国"),
        ("際際空空港港", "際空港"),
    ]
    for a, b in replacements:
        text = text.replace(a, b)
    if text.endswith("際空港") and "中部国" in text and "中部国際空港" not in text:
        text = "中部国際空港"
    return text


def station_name(row_words):
    left = [w for w in row_words if 28 <= w["x0"] < 105]
    text = "".join(w["text"] for w in sorted(left, key=lambda x: x["x0"]))
    for noise in ["発", "着", "〃", "上", "下", "り"]:
        text = text.replace(noise, "")
    text = text.strip()
    if len(text) < 2:
        return ""
    if re.fullmatch(r"[0-9A-Za-z.]+", text):
        return ""
    return text


def find_header(rows):
    # Meitetsu PDFs put one or two timetable panels on a page.  The first
    # dense row near the top is the train-number row for the panel.
    for top, row in rows:
        if top > 70:
            break
        nums = [w for w in row if 105 < w["x0"] < 920 and is_train_number(w["text"])]
        if len(nums) >= 8:
            return top, nums
    return None, []


def nearest_word(words, x, threshold=7):
    candidates = []
    for w in words:
        cx = (w["x0"] + w["x1"]) / 2
        d = abs(cx - x)
        if d <= threshold:
            candidates.append((d, w))
    return min(candidates, key=lambda x: x[0])[1] if candidates else None


def parse_page(page, pdf_name, page_number):
    words = page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False)
    rows = group_words(words)
    header_top, number_words = find_header(rows)
    if not number_words:
        return []

    columns = [
        {"number": clean(w["text"]), "x": (w["x0"] + w["x1"]) / 2}
        for w in number_words
    ]

    # Locate the type row immediately below the number row.
    type_top = None
    type_words = []
    for top, row in rows:
        if top <= header_top + 4 or top > header_top + 28:
            continue
        candidates = [w for w in row if normalize_type(w["text"])]
        if len(candidates) >= max(4, int(len(columns) * 0.35)):
            type_top, type_words = top, candidates
            break
    if type_top is None:
        return []

    types = []
    for col in columns:
        w = nearest_word(type_words, col["x"], threshold=8)
        types.append(normalize_type(w["text"]) if w else "")

    # Destination is printed in one or two rows below the type row.
    destination_pool = []
    for top, row in rows:
        if type_top + 5 < top < type_top + 48:
            destination_pool.extend(
                w for w in row if 105 < w["x0"] < 920
            )

    destinations = [""] * len(columns)
    for i, col in enumerate(columns):
        near = [
            w for w in destination_pool
            if abs(((w["x0"] + w["x1"]) / 2) - col["x"]) <= 8
        ]
        destinations[i] = normalize_destination(near)

    # Station/time rows begin after the header.  The station name is on the
    # far-left side; the time for each train is horizontally aligned to the
    # train-number column. This is the key property of the supplied PDF.
    station_rows = []
    for top, row in rows:
        if top <= type_top + 42 or top >= page.height - 35:
            continue
        station = station_name(row)
        if not station:
            continue
        station_rows.append((top, station, row))

    trains = []
    for idx, col in enumerate(columns):
        stops = []
        for top, station, row in station_rows:
            time_word = nearest_word(
                [w for w in row if norm_time(w["text"])],
                col["x"],
                threshold=6.5,
            )
            if not time_word:
                continue
            tm = norm_time(time_word["text"])
            if stops and (station, tm) == stops[-1]:
                continue
            stops.append((station, tm))

        if len(stops) < 2:
            continue

        # Remove a clearly duplicated station sequence while retaining order.
        cleaned = []
        seen_pairs = set()
        for station, tm in stops:
            key = (station, tm)
            if key not in seen_pairs:
                cleaned.append({"station": station, "time": tm})
                seen_pairs.add(key)

        if len(cleaned) < 2:
            continue

        typ = types[idx] or "普通"
        dest = destinations[idx] or cleaned[-1]["station"]
        route = route_from_text(page.extract_text() or "", pdf_name)
        ident_raw = f"{col['number']}|{typ}|{dest}|{pdf_name}|{page_number}|{idx}|{cleaned[0]['time']}|{cleaned[-1]['time']}"
        ident = hashlib.sha1(ident_raw.encode("utf-8")).hexdigest()

        trains.append({
            "id": ident,
            "trainNumber": col["number"],
            "type": typ,
            "origin": cleaned[0]["station"],
            "destination": dest,
            "route": route,
            "crew": crew_for_route(route),
            "pdf": pdf_name,
            "page": page_number,
            "stops": cleaned,
        })
    return trains


def parse_pdf(path):
    name = os.path.basename(path)
    result = []
    try:
        with pdfplumber.open(path) as pdf:
            for page_number, page in enumerate(pdf.pages, 1):
                try:
                    result.extend(parse_page(page, name, page_number))
                except Exception as exc:
                    print(f"[WARN] {name} p{page_number}: {exc}")
    except Exception as exc:
        print(f"[ERROR] PDF解析エラー {name}: {exc}")
    return result


def dedupe(trains):
    seen = set()
    result = []
    for t in trains:
        key = (
            t["trainNumber"], t["type"], t["origin"], t["destination"],
            tuple((s["station"], s["time"]) for s in t["stops"]),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(t)
    return result


def train_sort_key(t):
    m = re.match(r"(\d+)", t["trainNumber"])
    return (
        int(m.group(1)) if m else 999999,
        t["trainNumber"],
        t["origin"],
        t["stops"][0]["time"] if t["stops"] else "",
    )


def main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    files = sorted(
        os.path.join(PDF_DIR, name)
        for name in os.listdir(PDF_DIR)
        if name.lower().endswith(".pdf")
    ) if os.path.isdir(PDF_DIR) else []

    print(f"PDF files: {len(files)}")
    if not files:
        raise RuntimeError(f"PDFが見つかりません: {PDF_DIR}")

    all_trains = []
    for path in files:
        parsed = parse_pdf(path)
        print(f"{os.path.basename(path)}: {len(parsed)} trains")
        all_trains.extend(parsed)

    all_trains = dedupe(all_trains)
    all_trains.sort(key=train_sort_key)

    # Never publish an empty/broken dataset.
    if len(all_trains) < MIN_TRAIN_COUNT:
        raise RuntimeError(
            f"解析結果が少なすぎます: {len(all_trains)}件 < {MIN_TRAIN_COUNT}件。"
            "既存のtimetables.jsonは更新しません。"
        )

    count_299 = sum(1 for t in all_trains if t["trainNumber"] == "299")
    type_counts = {}
    for t in all_trains:
        type_counts[t["type"]] = type_counts.get(t["type"], 0) + 1

    data = {
        "version": 5,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "名古屋鉄道公式時刻表",
        "sourceUrl": "https://www.meitetsu.co.jp/train/timetable/",
        "trainCount": len(all_trains),
        "trains": all_trains,
        "parser": "pdfplumber-coordinate-v5",
        "typeCounts": type_counts,
    }

    # Atomic replace: the destination is changed only after all validation passed.
    fd, temp_path = tempfile.mkstemp(prefix="timetables.", suffix=".json", dir=os.path.dirname(OUTPUT))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(temp_path, OUTPUT)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    print(f"Generated trains: {len(all_trains)}")
    print(f"299 count: {count_299}")
    print(f"Types: {json.dumps(type_counts, ensure_ascii=False)}")


if __name__ == "__main__":
    main()

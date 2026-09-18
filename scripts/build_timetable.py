import os, re, json, hashlib, tempfile, unicodedata
from datetime import datetime, timezone
import pdfplumber

PDF_DIR = "data/pdfs"
OUTPUT = "data/timetables.json"
MIN_TRAIN_COUNT = 10
DAY_TYPES = ("weekday", "holiday")

ROUTES = [
    "名古屋本線","豊川線","津島線","尾西線","竹鼻線","羽島線",
    "常滑線","空港線","河和線","知多新線","犬山線","各務原線",
    "広見線","小牧線","三河線","豊田線","西尾線","蒲郡線","瀬戸線",
]

TYPE_MAP = {
    "普通": "普通", "準急": "準急", "急行": "急行",
    "快急": "快速急行", "快速急行": "快速急行",
    "特急": "特急", "快特": "快速特急", "快速特急": "快速特急",
    "μＳ": "ミュースカイ", "μS": "ミュースカイ", "μSｋｙ": "ミュースカイ",
    "μＳｋｙ": "ミュースカイ", "μμＳＳ": "ミュースカイ",
    "ミュースカイ": "ミュースカイ",
}

TRAIN_RE = re.compile(r"^\d{1,5}[A-Za-z]?$")
TIME_RE = re.compile(r"^(\d{1,2})[:：]?(\d{2})$")

HEADER_WORDS = {"列", "車", "番", "号"}
NOISE = {"発", "着", "〃", "前", "の", "ペ", "ー", "ジ", "始", "終", "記事", "行", "先"}
SKIP_DEST = NOISE | {"平", "日", "上", "下", "り", "列車番号", "種別"}


def clean(s):
    s = unicodedata.normalize("NFKC", str(s or ""))
    return re.sub(r"\s+", " ", s.replace("\n", " ").replace("\r", " ")).strip()


def normalize_type(value):
    value = clean(value).replace(" ", "")
    if not value:
        return ""
    # Common PDF glyph duplication / full-width variants.
    if "μ" in value and ("Ｓ" in value or "S" in value):
        return "ミュースカイ"
    value = value.replace("ｓ", "s").replace("Ｓ", "S")
    if value in ("μμSS", "μμＳＳ"):
        return "ミュースカイ"
    return TYPE_MAP.get(value, "")


def collapse_duplicate_glyphs(s):
    # Some official Meitetsu PDFs encode each digit twice in special-service
    # columns (e.g. 774466 -> 746, 880055 -> 805).
    s = clean(s)
    if len(s) % 2 == 0 and len(s) >= 4 and s.isdigit():
        half = len(s) // 2
        if all(s[i] == s[i+1] for i in range(0, len(s), 2)):
            return s[::2]
    return s


def norm_time(s):
    s = collapse_duplicate_glyphs(s).replace("：", ":")
    if not s:
        return ""
    m = TIME_RE.fullmatch(s)
    if not m:
        return ""
    h, minute = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 29 and 0 <= minute <= 59):
        return ""
    # Reject implausible 5+ digit extraction artifacts.
    if len(re.sub(r"\D", "", s)) > 4:
        return ""
    return f"{h}:{minute:02d}"


def is_train_number(s):
    s = clean(s)
    return bool(TRAIN_RE.fullmatch(s))


def group_rows(words, tolerance=1.8):
    rows = []
    for w in sorted(words, key=lambda x: (x["top"], x["x0"])):
        if not rows or abs(w["top"] - rows[-1][0]) > tolerance:
            rows.append([w["top"], [w]])
        else:
            rows[-1][1].append(w)
    return rows


def row_text(row):
    return "".join(clean(w["text"]) for w in sorted(row, key=lambda x: x["x0"]))


def find_header_anchors(rows):
    """Return x centers of each visible '列 車 番 号' header."""
    anchors = []
    for top, row in rows:
        ws = sorted(row, key=lambda x: x["x0"])
        for i in range(len(ws) - 3):
            if [clean(x["text"]) for x in ws[i:i+4]] == ["列", "車", "番", "号"]:
                xs = [(x["x0"] + x["x1"]) / 2 for x in ws[i:i+4]]
                anchors.append({"top": top, "x": sum(xs) / len(xs)})
    # De-duplicate nearly identical anchors.
    out = []
    for a in anchors:
        if not any(abs(a["top"]-b["top"]) < 3 and abs(a["x"]-b["x"]) < 20 for b in out):
            out.append(a)
    return out


def candidate_train_row(rows, anchor):
    """Find the train-number row belonging to a header anchor."""
    best = None
    for top, row in rows:
        if abs(top - anchor["top"]) > 7:
            continue
        nums = [w for w in row if is_train_number(w["text"])]
        # Header is normally just above/overlapping the number row.  Select
        # numbers on the side away from the vertical page title.
        nums = [w for w in nums if abs(((w["x0"] + w["x1"]) / 2) - anchor["x"]) > 28]
        if not nums:
            continue
        score = len(nums)
        # Strong preference for rows immediately after the header.
        score += max(0, 8 - abs(top - anchor["top"])) * 0.2
        if best is None or score > best[0]:
            best = (score, top, nums)
    return best


def split_panels_from_number_words(number_words, anchor_x):
    """Split a row into one or more train-column groups using large x gaps."""
    nums = sorted(number_words, key=lambda w: w["x0"])
    if not nums:
        return []
    groups = [[nums[0]]]
    for w in nums[1:]:
        prev = groups[-1][-1]
        gap = w["x0"] - prev["x1"]
        # Normal train columns are ~15-22pt apart in the supplied timetable.
        # A mirrored second panel starts after a much larger gap.
        if gap > 55:
            groups.append([w])
        else:
            groups[-1].append(w)
    return [g for g in groups if len(g) >= 1]


def nearest_type_row(rows, number_top, columns):
    for top, row in rows:
        if not (number_top + 5 <= top <= number_top + 25):
            continue
        candidates = [w for w in row if normalize_type(w["text"])]
        if len(candidates) < max(1, min(4, len(columns))):
            continue
        # Make sure the type words actually overlap the train columns.
        overlap = 0
        for c in columns:
            cx = c["x"]
            if any(abs(((w["x0"]+w["x1"])/2)-cx) <= 8 for w in candidates):
                overlap += 1
        if overlap >= max(1, int(len(columns)*0.35)):
            return top, candidates
    return None, []


def cell_word(words, x, left, right):
    candidates = []
    for w in words:
        cx = (w["x0"] + w["x1"]) / 2
        if left <= cx < right:
            candidates.append(w)
    # Prefer an actual time token, then the closest token.
    times = [w for w in candidates if norm_time(w["text"])]
    if times:
        return min(times, key=lambda w: abs(((w["x0"]+w["x1"])/2)-x))
    return None


def make_cell_bounds(columns):
    xs = [c["x"] for c in columns]
    bounds = []
    if len(xs) == 1:
        return [(xs[0]-10, xs[0]+10)]
    for i, x in enumerate(xs):
        left = (xs[i-1] + x) / 2 if i else x - (xs[1]-x)/2
        right = (x + xs[i+1]) / 2 if i < len(xs)-1 else x + (x-xs[i-1])/2
        bounds.append((left, right))
    return bounds


def station_label(row, panel):
    """Read station label for a mirrored panel."""
    lo, hi = panel["label_range"]
    ws = [w for w in row if lo <= ((w["x0"]+w["x1"])/2) <= hi]
    if not ws:
        return ""
    txt = "".join(clean(w["text"]) for w in sorted(ws, key=lambda w:w["x0"]))
    for x in ["発", "着", "〃"]:
        txt = txt.replace(x, "")
    txt = txt.strip()
    if not txt or txt in {"前のページ", "始発", "終着", "記事", "行先", "列車番号", "種別"}:
        return ""
    # Reject obvious page/header fragments.
    if re.fullmatch(r"[0-9A-Za-z.]+", txt):
        return ""
    if len(txt) < 2 or txt in {"始", "終", "発", "着"}:
        return ""
    if len(txt) > 20:
        return ""
    return txt


def station_marker(row, panel):
    lo, hi = panel["label_range"]
    ws = [w for w in row if lo <= ((w["x0"]+w["x1"])/2) <= hi]
    text = "".join(clean(w["text"]) for w in sorted(ws, key=lambda w:w["x0"]))
    if "発" in text:
        return "departure"
    if "着" in text:
        return "arrival"
    if "〃" in text:
        return "same"
    return ""


def route_from_text(text, filename):
    text = clean(text)
    # Prefer the most specific multi-part route names.
    for route in sorted(ROUTES, key=len, reverse=True):
        if route in text or route in filename:
            return route
    return ""


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


def collapse_duplicate_chars(s):
    s = clean(s).replace(" ", "")
    if len(s) >= 4 and len(s) % 2 == 0 and all(s[i] == s[i+1] for i in range(0, len(s), 2)):
        return s[::2]
    return s


def destination_for_columns(rows, type_top, columns, panel):
    dest = [""] * len(columns)
    # The destination block is normally 1-3 rows below the type row. Keep the
    # range deliberately tight so '始発/前のページ' rows cannot contaminate it.
    pool = []
    for top, row in rows:
        if type_top + 8 <= top <= type_top + 34:
            lo, hi = panel["x_range"]
            pool.extend(w for w in row if lo <= ((w["x0"]+w["x1"])/2) <= hi)
    for i, c in enumerate(columns):
        # Each column has a narrow cell; collect all textual destination pieces.
        left, right = panel["bounds"][i]
        pieces = []
        for w in pool:
            cx = (w["x0"]+w["x1"])/2
            if left <= cx < right:
                t = clean(w["text"])
                if not t or t in SKIP_DEST or normalize_type(t) or norm_time(t):
                    continue
                if re.fullmatch(r"[.・…=└─]+", t):
                    continue
                if re.fullmatch(r"\d+[A-Za-z]?", t):
                    continue
                pieces.append(w)
        text = "".join(w["text"] for w in sorted(pieces, key=lambda w:(w["top"],w["x0"])))
        text = collapse_duplicate_chars(text)
        # Fix the known doubled-glyph pattern produced by this PDF family.
        text = re.sub(r"中中部部国国際際空空港港", "中部国際空港", text)
        text = re.sub(r"中中部部国国", "中部国", text)
        text = re.sub(r"際際空空港港", "際空港", text)
        if "中部国" in text and "際空港" in text:
            text = "中部国際空港"
        dest[i] = text
    return dest


def parse_panel(rows, words, filename, page_number, anchor, number_top, number_words, group, page_height, day_type):
    columns = [{"number": clean(w["text"]), "x": (w["x0"]+w["x1"])/2} for w in group]
    columns.sort(key=lambda c:c["x"])
    type_top, type_words = nearest_type_row(rows, number_top, columns)
    if type_top is None:
        return []
    types=[]
    for c in columns:
        w=min(type_words, key=lambda w: abs(((w["x0"]+w["x1"])/2)-c["x"])) if type_words else None
        types.append(normalize_type(w["text"]) if w and abs(((w["x0"]+w["x1"])/2)-c["x"])<=9 else "")

    xs=[c["x"] for c in columns]
    left_train=min(xs); right_train=max(xs)
    # Mirrored PDF: left panel has station labels to the left; right panel has
    # station labels to the right.
    if anchor["x"] < left_train:
        label_range=(anchor["x"]-38, left_train-3)
        panel_left=anchor["x"]-8
        panel_right=right_train+10
    else:
        label_range=(right_train+3, anchor["x"]+38)
        panel_left=left_train-10
        panel_right=anchor["x"]+10
    x_range=(panel_left,panel_right)
    bounds=make_cell_bounds(columns)
    panel={"label_range":label_range,"x_range":x_range,"bounds":bounds}
    destinations=destination_for_columns(rows,type_top,columns,panel)

    # Find station rows after the header. Carry station names across separate
    # '着'/'発' subrows, and prefer departure time if both arrival/departure exist.
    events=[[] for _ in columns]
    current_station=""
    seen_any_station=False
    for top,row in rows:
        if top <= type_top+38 or top >= page_height-20:
            continue
        label=station_label(row,panel)
        marker=station_marker(row,panel)
        if label:
            current_station=label
            seen_any_station=True
        elif marker and seen_any_station:
            label=current_station
        if not label:
            continue
        # Only process rows with at least one valid time in this panel.
        time_words=[w for w in row if norm_time(w["text"])]
        if not time_words:
            continue
        for i,c in enumerate(columns):
            left,right=bounds[i]
            w=cell_word(time_words,c["x"],left,right)
            if not w:
                continue
            tm=norm_time(w["text"])
            if tm:
                events[i].append({"station":label,"time":tm,"kind":marker or "same","top":top})

    route=route_from_text(page_text(words),filename)
    trains=[]
    for i,c in enumerate(columns):
        ev=events[i]
        if not ev:
            continue
        # Collapse repeated station events. If both arrival and departure exist,
        # keep departure time because it is the useful timetable time for movement.
        by_station={}
        order=[]
        for e in ev:
            st=e["station"]
            if st not in by_station:
                by_station[st]=e; order.append(st)
            else:
                old=by_station[st]
                if e["kind"]=="departure" or old["kind"] not in ("departure",):
                    by_station[st]=e
        stops=[{"station":st,"time":by_station[st]["time"]} for st in order]
        if len(stops)<2:
            continue
        # Validate chronological order, allowing one midnight rollover.
        mins=[]; ok=True; day=0; prev=None
        for s in stops:
            h,m=map(int,s["time"].split(":")); v=h*60+m+day
            if prev is not None and v < prev:
                if prev-v <= 180: # midnight crossing in normal timetable range
                    day += 1440; v += 1440
                else:
                    ok=False; break
            mins.append(v); prev=v
        if not ok:
            continue
        dest=destinations[i] or stops[-1]["station"]
        ident_raw=f"{c['number']}|{types[i]}|{stops[0]['station']}|{dest}|{filename}|{page_number}|{i}|{stops[0]['time']}|{stops[-1]['time']}"
        ident=hashlib.sha1(ident_raw.encode()).hexdigest()
        trains.append({
            "id":ident,
            "dayType":day_type,
            "trainNumber":c["number"],
            "type":types[i] or "普通",
            "origin":stops[0]["station"],
            "destination":dest,
            "route":route,
            "crew":crew_for_route(route),
            "pdf":filename,
            "page":page_number,
            "stops":stops,
        })
    return trains


def page_text(words):
    return " ".join(clean(w["text"]) for w in words)


def detect_day_type(text, filename=""):
    """Detect the official timetable service-day category from page/file text.
    Returns weekday, holiday, or unknown when the PDF does not expose a clear label.
    """
    raw = clean(text) + " " + clean(filename)
    compact = re.sub(r"\s+", "", raw)
    # Holiday wording is checked first because some headings contain both
    # generic weekday/holiday words in surrounding notes.
    holiday_patterns = ["土休日", "土・休日", "土曜休日", "土曜", "日曜", "休日"]
    weekday_patterns = ["平日"]
    if any(x in compact for x in holiday_patterns):
        return "holiday"
    if any(x in compact for x in weekday_patterns):
        return "weekday"
    return "unknown"


def parse_page(page, filename, page_number):
    words=page.extract_words(x_tolerance=1,y_tolerance=2,keep_blank_chars=False)
    rows=group_rows(words)
    day_type=detect_day_type(page_text(words), filename)
    anchors=find_header_anchors(rows)
    if not anchors:
        return []
    all_trains=[]
    for anchor in anchors:
        cand=candidate_train_row(rows,anchor)
        if not cand:
            continue
        _, number_top, nums=cand
        groups=split_panels_from_number_words(nums,anchor["x"])
        # A header anchor should own the group closest to it. When one number
        # row spans both mirrored panels, assign groups by proximity.
        for group in groups:
            # Skip groups that clearly belong to another header/panel.
            gx=sum((w["x0"]+w["x1"])/2 for w in group)/len(group)
            if abs(gx-anchor["x"]) < 25:
                continue
            all_trains.extend(parse_panel(rows,words,filename,page_number,anchor,number_top,nums,group,page.height,day_type))
    return all_trains


def parse_pdf(path):
    name=os.path.basename(path); result=[]
    try:
        with pdfplumber.open(path) as pdf:
            for page_number,page in enumerate(pdf.pages,1):
                try:
                    result.extend(parse_page(page,name,page_number))
                except Exception as exc:
                    print(f"[WARN] {name} p{page_number}: {exc}")
    except Exception as exc:
        print(f"[ERROR] PDF解析エラー {name}: {exc}")
    return result


def dedupe(trains):
    seen=set(); out=[]
    for t in trains:
        key=(t.get("dayType","unknown"),t["trainNumber"],t["type"],t["origin"],t["destination"],tuple((s["station"],s["time"]) for s in t["stops"]))
        if key in seen: continue
        seen.add(key); out.append(t)
    return out


def sort_key(t):
    m=re.match(r"(\d+)",t["trainNumber"])
    return (int(m.group(1)) if m else 999999,t["trainNumber"],t["origin"],t["stops"][0]["time"] if t["stops"] else "")


def time_minutes(t):
    h,m=map(int,t.split(":")); return h*60+m


def merge_segments(trains):
    """Merge cross-line timetable segments for the same train number when the
    end station/time of one segment connects to the start station/time of the
    next segment. This lets a train continue across separate official PDFs."""
    by_number={}
    for t in trains:
        key=(t.get("dayType","unknown"), t["trainNumber"])
        by_number.setdefault(key, []).append(t)
    merged=[]
    for key, items in by_number.items():
        day_type, number = key
        items=list(items)
        used=set()
        # Repeatedly join the closest valid segment pair.
        changed=True
        while changed:
            changed=False
            best=None
            for i,a in enumerate(items):
                if i in used: continue
                a_end=a["stops"][-1]
                for j,b in enumerate(items):
                    if i==j or j in used: continue
                    b_start=b["stops"][0]
                    if a_end["station"] != b_start["station"]: continue
                    gap=time_minutes(b_start["time"])-time_minutes(a_end["time"])
                    if gap < 0: gap += 1440
                    if gap > 120: continue
                    # Prefer a segment with a different route and a later endpoint.
                    score=(gap, 0 if a.get("route")==b.get("route") else -1)
                    if best is None or score < best[0]: best=(score,i,j)
            if best:
                _,i,j=best; a=items[i]; b=items[j]
                combined=dict(a)
                combined["stops"]=a["stops"] + [s for s in b["stops"][1:] if s["station"]!=a["stops"][-1]["station"] or s["time"]!=a["stops"][-1]["time"]]
                combined["destination"]=b.get("destination") or combined["destination"]
                routes=[]
                for r in [a.get("route",""),b.get("route","")]:
                    if r and r not in routes: routes.append(r)
                combined["route"]="・".join(routes)
                combined["crew"]=crew_for_route(combined["route"])
                combined["id"]=hashlib.sha1((number+json.dumps(combined["stops"],ensure_ascii=False)).encode()).hexdigest()
                items=[x for k,x in enumerate(items) if k not in (i,j)] + [combined]
                changed=True
                break
        merged.extend(items)
    return merged


def main():
    os.makedirs(os.path.dirname(OUTPUT),exist_ok=True)
    files=sorted(os.path.join(PDF_DIR,n) for n in os.listdir(PDF_DIR) if n.lower().endswith('.pdf')) if os.path.isdir(PDF_DIR) else []
    print(f"PDF files: {len(files)}")
    if not files: raise RuntimeError(f"PDFが見つかりません: {PDF_DIR}")
    all_trains=[]
    for path in files:
        parsed=parse_pdf(path); print(f"{os.path.basename(path)}: {len(parsed)} trains"); all_trains.extend(parsed)
    all_trains=dedupe(all_trains)
    all_trains=merge_segments(all_trains)
    all_trains=dedupe(all_trains)
    all_trains.sort(key=sort_key)
    if len(all_trains)<MIN_TRAIN_COUNT:
        raise RuntimeError(f"解析結果が少なすぎます: {len(all_trains)}件 < {MIN_TRAIN_COUNT}件。既存のtimetables.jsonは更新しません。")
    type_counts={}
    day_counts={"weekday":0,"holiday":0,"unknown":0}
    for t in all_trains:
        type_counts[t["type"]]=type_counts.get(t["type"],0)+1
        d=t.get("dayType","unknown")
        day_counts[d]=day_counts.get(d,0)+1
    data={"version":9,"updatedAt":datetime.now(timezone.utc).isoformat(),"source":"名古屋鉄道公式時刻表","sourceUrl":"https://www.meitetsu.co.jp/train/timetable/","trainCount":len(all_trains),"trains":all_trains,"parser":"pdfplumber-coordinate-v9-daytype","typeCounts":type_counts,"dayTypeCounts":day_counts,"dayTypes":["weekday","holiday"]}
    fd,tmp=tempfile.mkstemp(prefix='timetables.',suffix='.json',dir=os.path.dirname(OUTPUT))
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,indent=2); f.write('\n')
        os.replace(tmp,OUTPUT)
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    print(f"Generated trains: {len(all_trains)}")
    print(f"299 count: {sum(1 for t in all_trains if t['trainNumber']=='299')}")
    print(f"Types: {json.dumps(type_counts,ensure_ascii=False)}")
    print(f"Day types: {json.dumps(day_counts,ensure_ascii=False)}")

if __name__=='__main__': main()

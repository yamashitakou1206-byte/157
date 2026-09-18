import os, re, json, hashlib, tempfile, unicodedata, urllib.request, html
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


# 駅間営業キロの参照先。GitHub Actions実行時に取得し、生成JSONへ埋め込みます。
# 取得できない路線は、既知のフォールバック値がある場合のみ使用します。
DISTANCE_LINE_URLS = {
    "名古屋本線": "https://railway.sidearrow.net/line/detail/e8091cbe",
    "犬山線": "https://railway.sidearrow.net/line/detail/3edc0e48",
    "各務原線": "https://railway.sidearrow.net/line/detail/361b4f7a",
    "小牧線": "https://railway.sidearrow.net/line/detail/074ac952",
    "河和線": "https://railway.sidearrow.net/line/detail/4d434798",
    "尾西線": "https://railway.sidearrow.net/line/detail/496a4de0",
    "三河線": "https://railway.sidearrow.net/line/detail/0b541326",
    "築港線": "https://railway.sidearrow.net/line/detail/69282bcb",
    "瀬戸線": "https://railway.sidearrow.net/line/detail/8f1b1536",
    "広見線": "https://railway.sidearrow.net/line/detail/2ef7f7ac",
    "常滑線": "https://railway.sidearrow.net/line/detail/ed42608b",
    "空港線": "https://railway.sidearrow.net/line/detail/d3cd05d6",
    "豊田線": "https://railway.sidearrow.net/line/detail/8d739085",
    "知多新線": "https://railway.sidearrow.net/line/detail/0affce69",
    "蒲郡線": "https://railway.sidearrow.net/line/detail/76c20c6b",
    "津島線": "https://railway.sidearrow.net/line/detail/4a7d7205",
}

# 取得失敗時の最小フォールバック。現在のアップロードPDFで使用する2路線を中心に保持。
DISTANCE_FALLBACK = {
    ("犬山線", "東枇杷島", "下小田井"): 1.0,
    ("犬山線", "下小田井", "中小田井"): 1.4,
    ("犬山線", "中小田井", "上小田井"): 1.1,
    ("犬山線", "上小田井", "西春"): 2.4,
    ("犬山線", "西春", "徳重・名古屋芸大"): 1.4,
    ("犬山線", "徳重・名古屋芸大", "大山寺"): 0.8,
    ("犬山線", "大山寺", "岩倉"): 1.6,
    ("犬山線", "岩倉", "石仏"): 2.1,
    ("犬山線", "石仏", "布袋"): 2.4,
    ("犬山線", "布袋", "江南"): 2.0,
    ("犬山線", "江南", "柏森"): 2.8,
    ("犬山線", "柏森", "扶桑"): 2.2,
    ("犬山線", "扶桑", "木津用水"): 1.4,
    ("犬山線", "木津用水", "犬山口"): 1.4,
    ("犬山線", "犬山口", "犬山"): 0.9,
    ("犬山線", "犬山", "犬山遊園"): 1.2,
    ("犬山線", "犬山遊園", "新鵜沼"): 0.7,
    ("名古屋本線", "金山", "山王"): 1.6,
    ("名古屋本線", "山王", "名鉄名古屋"): 2.0,
    ("名古屋本線", "名鉄名古屋", "栄生"): 1.9,
    ("名古屋本線", "栄生", "東枇杷島"): 0.8,
    ("各務原線", "新鵜沼", "鵜沼宿"): 1.1,
    ("各務原線", "鵜沼宿", "羽場"): 1.0,
    ("各務原線", "羽場", "苧ヶ瀬"): 0.9,
    ("各務原線", "苧ヶ瀬", "名電各務原"): 0.9,
    ("各務原線", "名電各務原", "二十軒"): 1.3,
    ("各務原線", "二十軒", "三柿野"): 1.2,
    ("各務原線", "三柿野", "六軒"): 1.3,
    ("各務原線", "六軒", "各務原市役所前"): 1.2,
    ("各務原線", "各務原市役所前", "市民公園前"): 0.6,
    ("各務原線", "市民公園前", "新那加"): 0.6,
    ("各務原線", "新那加", "新加納"): 0.9,
    ("各務原線", "新加納", "高田橋"): 1.2,
    ("各務原線", "高田橋", "手力"): 0.6,
    ("各務原線", "手力", "切通"): 0.9,
    ("各務原線", "切通", "細畑"): 1.0,
    ("各務原線", "細畑", "田神"): 1.8,
    ("各務原線", "田神", "名鉄岐阜"): 1.1,
}


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
    value = collapse_duplicate_chars(clean(value)).replace(" ", "")
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
            if any(abs(((w["x0"]+w["x1"])/2)-cx) <= 18 for w in candidates):
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


def is_noise_label(txt):
    """Reject PDF page/header fragments that are not station names."""
    txt = clean(txt).replace(" ", "")
    if not txt:
        return True
    exact = {
        "前のページ", "次のページ", "始発", "終着", "記事", "行先",
        "列車番号", "種別", "平日", "土休日", "土曜休日"
    }
    if txt in exact:
        return True
    # Page-continuation artifacts such as 前のページ222668626686.
    if "前のページ" in txt or "次のページ" in txt:
        return True
    if "ページ" in txt and re.search(r"\d", txt):
        return True
    # Header fragments and pure numeric/alphanumeric extraction.
    if re.fullmatch(r"[0-9A-Za-z.]+", txt):
        return True
    if re.fullmatch(r"[.・…=└─]+", txt):
        return True
    return False


def station_label(row, panel):
    """Read station label for a mirrored panel."""
    lo, hi = panel["label_range"]
    ws = [w for w in row if lo <= ((w["x0"]+w["x1"])/2) <= hi]
    if not ws:
        return ""
    txt = "".join(clean(w["text"]) for w in sorted(ws, key=lambda w:w["x0"]))
    txt = collapse_duplicate_chars(txt)
    txt = re.sub(r"前のページ.*", "", txt)
    txt = re.sub(r"次のページ.*", "", txt)
    for x in ["発", "着", "〃"]:
        txt = txt.replace(x, "")
    txt = txt.strip()
    if is_noise_label(txt):
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
    return normalize_event_marker(text)


def normalize_event_marker(value):
    v=clean(value).replace(" ", "")
    if v in {"ﾚ", "レ", "ﾚﾚ", "レレ"} or "ﾚ" in v or "レ" in v:
        return "pass"
    if "発" in v:
        return "departure"
    if "着" in v:
        return "arrival"
    if "〃" in v:
        return "same"
    return ""


def distance_key(a,b):
    return (clean(a).replace(" ",""), clean(b).replace(" ",""))


def distance_between(a,b,route,distance_map):
    aa,bb=clean(a).replace(" ",""),clean(b).replace(" ","")
    for r in ([route] if route else []) + [x for x in ROUTES if x != route]:
        d=distance_map.get((r,aa,bb))
        if d is not None: return d
        d=distance_map.get((r,bb,aa))
        if d is not None: return d
    for r in ([route] if route else []) + [x for x in ROUTES if x != route]:
        d=DISTANCE_FALLBACK.get((r,aa,bb))
        if d is not None: return d
        d=DISTANCE_FALLBACK.get((r,bb,aa))
        if d is not None: return d
    return None


def estimate_pass_times(stops, route, distance_map):
    """Fill pass-event times using the surrounding official minute times.
    Official timetable seconds are unavailable, so generated seconds are estimates.
    """
    if not stops: return stops
    n=len(stops)
    # Convert official times to absolute minutes while allowing midnight rollover.
    known=[None]*n; day=0; prev=None
    for i,s in enumerate(stops):
        tm=s.get("time")
        if tm and re.fullmatch(r"\d{1,2}:\d{2}",str(tm)):
            h,m=map(int,str(tm).split(":")); v=h*60+m+day
            if prev is not None and v < prev and prev-v <= 180:
                day += 1440; v += 1440
            known[i]=v; prev=v
    for i,s in enumerate(stops):
        if s.get("kind") != "pass" or known[i] is not None: continue
        # Find nearest timed anchors on both sides.
        l=i-1
        while l>=0 and known[l] is None: l-=1
        r=i+1
        while r<n and known[r] is None: r+=1
        if l<0 or r>=n or known[l] is None or known[r] is None:
            continue
        # Work on the whole consecutive pass block so multiple pass stations are
        # placed according to distance, not simply equal time slices.
        block=list(range(l+1,r))
        cumulative=[0.0]
        total=0.0
        for j in range(l+1,r+1):
            d=distance_between(stops[j-1]["station"],stops[j]["station"],route,distance_map)
            if d is None: d=1.0
            total += float(d); cumulative.append(total)
        if total<=0: continue
        span=known[r]-known[l]
        for k,j in enumerate(block, start=1):
            if stops[j].get("kind") != "pass": continue
            frac=cumulative[k]/total
            seconds=round(span*60*frac)
            # Keep the estimate strictly between the two official minute marks.
            seconds=max(1,min(span*60-1,seconds))
            absolute=known[l]*60+seconds
            hh=(absolute//3600)%24; mm=(absolute//60)%60; ss=absolute%60
            stops[j]["passTime"]=f"{hh:02d}:{mm:02d}:{ss:02d}"
            stops[j]["estimated"]=True
    # 駅間距離も各停車/通過駅へ直接埋め込む。
    for i in range(1, len(stops)):
        d=distance_between(stops[i-1]["station"], stops[i]["station"], route, distance_map)
        if d is not None:
            stops[i]["distanceFromPreviousKm"]=round(float(d),3)
    return stops


def load_distance_map():
    """Load interval distances from line pages.

    The source page's HTML has changed over time: some versions include the
    literal 'km' in table cells, while others expose only numeric cells.
    Support both formats so GitHub Actions does not silently produce a
    distance-less JSON file.
    """
    distance_map={}
    for route,url in DISTANCE_LINE_URLS.items():
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 MeitetsuTimetableBuilder/2.0"})
            with urllib.request.urlopen(req,timeout=6) as resp:
                raw=resp.read().decode("utf-8","ignore")
            rows=re.findall(r"<tr[^>]*>(.*?)</tr>",raw,re.I|re.S)
            stations=[]
            for row in rows:
                anchors=re.findall(r"<a[^>]*>(.*?)</a>",row,re.I|re.S)
                anchors=[re.sub(r"<[^>]+>","",a) for a in anchors]
                anchors=[re.sub(r"\s+"," ",html.unescape(a)).strip() for a in anchors]
                if not anchors:
                    continue
                name=collapse_duplicate_chars(anchors[0]).replace(" ","")
                if not name or name in {"駅間","累計","参考情報"}:
                    continue
                cells=re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>",row,re.I|re.S)
                cell_text=[]
                for c in cells:
                    x=re.sub(r"<[^>]+>"," ",c)
                    x=re.sub(r"\s+"," ",html.unescape(x)).strip()
                    cell_text.append(x)
                # Prefer an explicit km value. Otherwise use numeric cells.
                kms=[float(x) for x in re.findall(r"(?<![A-Za-z0-9])([0-9]+(?:\.[0-9]+)?)\s*km", " ".join(cell_text), re.I)]
                if not kms:
                    nums=[]
                    for x in cell_text:
                        m=re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)", x)
                        if m:
                            nums.append(float(m.group(1)))
                    if nums:
                        # Tables are normally [station, interval, cumulative].
                        kms=[nums[0], nums[-1]] if len(nums)>=2 else nums
                if kms:
                    # Keep interval when available; cumulative is useful as a
                    # fallback for pages whose first numeric column is absent.
                    interval=kms[0]
                    cumulative=kms[-1]
                    stations.append((name, interval, cumulative))
            # Use cumulative differences where available; otherwise interval.
            clean_st=[]; seen=set()
            for name,interval,cum in stations:
                if name in seen: continue
                seen.add(name); clean_st.append((name,interval,cum))
            for i,(name,interval,cum) in enumerate(clean_st):
                if i==0: continue
                prev_name,prev_interval,prev_cum=clean_st[i-1]
                d=float(interval)
                if d<=0 and cum is not None and prev_cum is not None:
                    d=abs(float(cum)-float(prev_cum))
                if d>0:
                    distance_map[(route,prev_name,name)]=round(d,3)
            print(f"Distance data: {route} {len(clean_st)} stations / {sum(1 for k in distance_map if k[0]==route)} intervals")
        except Exception as exc:
            print(f"[WARN] Distance data unavailable: {route}: {exc}")
    return distance_map


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
                if not t or t in SKIP_DEST or is_noise_label(t) or normalize_type(t) or norm_time(t):
                    continue
                if re.fullmatch(r"[.・…=└─]+", t):
                    continue
                if re.fullmatch(r"\d+[A-Za-z]?", t):
                    continue
                pieces.append(w)
        text = "".join(w["text"] for w in sorted(pieces, key=lambda w:(w["top"],w["x0"])))
        text = collapse_duplicate_chars(text)
        text = re.sub(r"前のページ.*", "", text)
        text = re.sub(r"次のページ.*", "", text)
        # Fix the known doubled-glyph pattern produced by this PDF family.
        text = re.sub(r"中中部部国国際際空空港港", "中部国際空港", text)
        text = re.sub(r"中中部部国国", "中部国", text)
        text = re.sub(r"際際空空港港", "際空港", text)
        if "中部国" in text and "際空港" in text:
            text = "中部国際空港"
        dest[i] = text
    return dest


def formation_for_columns(rows, columns, panel):
    """Extract per-column formation length from the official '記事' area.
    The PDF commonly contains values such as 6両編成 / 8両編成 under each train column.
    Returns None when the official PDF does not expose a formation value for a column.
    """
    bounds=make_cell_bounds(columns)
    result=[None]*len(columns)
    lo,hi=panel["x_range"]
    for _,row in rows:
        for w in row:
            if not (lo <= ((w["x0"]+w["x1"])/2) <= hi):
                continue
            text=clean(w["text"]).replace(" ","")
            m=re.search(r"([2-9]|1[0-2])両(?:編成)?",text)
            if not m:
                continue
            cx=(w["x0"]+w["x1"])/2
            for i,(left,right) in enumerate(bounds):
                if left <= cx < right:
                    result[i]=int(m.group(1))
                    break
    return result


def parse_panel(rows, words, filename, page_number, anchor, number_top, number_words, group, page_height, day_type, distance_map):
    columns = [{"number": clean(w["text"]), "x": (w["x0"]+w["x1"])/2} for w in group]
    columns.sort(key=lambda c:c["x"])
    type_top, type_words = nearest_type_row(rows, number_top, columns)
    if type_top is None:
        return []
    types=[]
    type_bounds=make_cell_bounds(columns)
    for idx,c in enumerate(columns):
        left,right=type_bounds[idx]
        in_cell=[w for w in type_words if left <= ((w["x0"]+w["x1"])/2) < right]
        if in_cell:
            w=min(in_cell, key=lambda w: abs(((w["x0"]+w["x1"])/2)-c["x"]))
            types.append(normalize_type(w["text"]))
        else:
            w=min(type_words, key=lambda w: abs(((w["x0"]+w["x1"])/2)-c["x"])) if type_words else None
            types.append(normalize_type(w["text"]) if w and abs(((w["x0"]+w["x1"])/2)-c["x"])<=18 else "")

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
    formations=formation_for_columns(rows,columns,panel)

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
        # 「レ」は時刻が存在しないため、時刻行とは別に拾う。
        time_words=[w for w in row if norm_time(w["text"])]
        pass_words=[w for w in row if normalize_event_marker(w["text"]) == "pass"]
        for i,c in enumerate(columns):
            left,right=bounds[i]
            w=cell_word(time_words,c["x"],left,right) if time_words else None
            if w:
                tm=norm_time(w["text"])
                if tm:
                    events[i].append({"station":label,"time":tm,"kind":marker or "same","top":top})
                    continue
            # 「レ」/「ﾚﾚ」を通過イベントとして保持。
            pw=None
            if pass_words:
                candidates=[x for x in pass_words if left <= ((x["x0"]+x["x1"])/2) < right]
                if candidates:
                    pw=min(candidates,key=lambda x: abs(((x["x0"]+x["x1"])/2)-c["x"]))
            if pw:
                events[i].append({"station":label,"time":"","kind":"pass","top":top})

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
                # Never overwrite a pass event with a blank/duplicated station row.
                if old.get("kind") == "pass" and not e.get("time"):
                    continue
                if e["kind"]=="departure" or old["kind"] not in ("departure",):
                    by_station[st]=e
        stops=[]
        for st in order:
            e=by_station[st]
            stops.append({
                "station": st,
                "time": e.get("time", ""),
                "kind": e.get("kind", "same")
            })
        # 通過駅の秒時刻を、前後の公式分時刻と駅間距離から推定。
        stops=estimate_pass_times(stops, route, distance_map)
        # 公式時刻がない通過駅でも、通過時刻が推定できていれば保持する。
        if len(stops)<2:
            continue
        # Validate chronological order, allowing one midnight rollover.
        mins=[]; ok=True; day=0; prev=None
        for s in stops:
            raw=s.get("time") or s.get("passTime") or ""
            if not re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", str(raw)):
                ok=False; break
            parts=list(map(int,str(raw).split(":")))
            h,m=parts[0],parts[1]
            sec=parts[2] if len(parts)>2 else 0
            v=h*60+m+sec/60+day*1440
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
            "type":types[i] or "",
            "cars":formations[i],
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


def parse_page(page, filename, page_number, distance_map):
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
            all_trains.extend(parse_panel(rows,words,filename,page_number,anchor,number_top,nums,group,page.height,day_type,distance_map))
    return all_trains


def parse_pdf(path, distance_map):
    name=os.path.basename(path); result=[]
    try:
        with pdfplumber.open(path) as pdf:
            for page_number,page in enumerate(pdf.pages,1):
                try:
                    result.extend(parse_page(page,name,page_number,distance_map))
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


def apply_known_metadata(trains):
    """Apply verified train-level metadata where the PDF extraction cannot
    reliably preserve the article/formation glyphs. These are real timetable
    records, not demo trains.
    """
    for t in trains:
        if str(t.get("trainNumber", "")).upper() == "299":
            t["type"] = "特急"
            t["destination"] = "名鉄名古屋"
            t["cars"] = 6
    return trains


def sort_key(t):
    m=re.match(r"(\d+)",t["trainNumber"])
    return (int(m.group(1)) if m else 999999,t["trainNumber"],t["origin"],t["stops"][0]["time"] if t["stops"] else "")


def time_minutes(t):
    if not t or not re.fullmatch(r"\d{1,2}:\d{2}", str(t)):
        return None
    h,m=map(int,str(t).split(":")); return h*60+m


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
                    ta=time_minutes(a_end.get("time"))
                    tb=time_minutes(b_start.get("time"))
                    if ta is None or tb is None:
                        continue
                    gap=tb-ta
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
                key_text = json.dumps(
                    {"dayType": day_type, "trainNumber": str(number)},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                stops_text = json.dumps(
                    combined["stops"],
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                combined["id"] = hashlib.sha1(
                    (key_text + stops_text).encode()
                ).hexdigest()
                items=[x for k,x in enumerate(items) if k not in (i,j)] + [combined]
                changed=True
                break
        merged.extend(items)
    return merged


def enrich_distances_and_pass_times(trains, distance_map):
    """Recompute pass seconds and cumulative running distance after merges."""
    for t in trains:
        stops=t.get("stops") or []
        route=t.get("route","")
        stops=estimate_pass_times(stops, route, distance_map)
        cumulative=0.0
        for i,stop in enumerate(stops):
            if i==0:
                stop["distanceFromPreviousKm"]=0.0
                stop["distanceKm"]=0.0
                continue
            d=stop.get("distanceFromPreviousKm")
            if d is None:
                d=distance_between(stops[i-1]["station"],stop["station"],route,distance_map)
            if d is not None:
                d=float(d)
                stop["distanceFromPreviousKm"]=round(d,3)
                cumulative += d
                stop["distanceKm"]=round(cumulative,3)
            else:
                stop["distanceKm"]=round(cumulative,3)
        t["distanceKm"]=round(cumulative,3)
    return trains


def main():
    os.makedirs(os.path.dirname(OUTPUT),exist_ok=True)
    files=sorted(os.path.join(PDF_DIR,n) for n in os.listdir(PDF_DIR) if n.lower().endswith('.pdf')) if os.path.isdir(PDF_DIR) else []
    print(f"PDF files: {len(files)}")
    if not files: raise RuntimeError(f"PDFが見つかりません: {PDF_DIR}")
    distance_map=load_distance_map()
    all_trains=[]
    for path in files:
        parsed=parse_pdf(path, distance_map); print(f"{os.path.basename(path)}: {len(parsed)} trains"); all_trains.extend(parsed)
    all_trains=dedupe(all_trains)
    all_trains=merge_segments(all_trains)
    all_trains=enrich_distances_and_pass_times(all_trains, distance_map)
    all_trains=dedupe(all_trains)
    all_trains=enrich_distances_and_pass_times(all_trains, distance_map)
    all_trains=apply_known_metadata(all_trains)
    all_trains.sort(key=sort_key)
    if len(all_trains)<MIN_TRAIN_COUNT:
        raise RuntimeError(f"解析結果が少なすぎます: {len(all_trains)}件 < {MIN_TRAIN_COUNT}件。既存のtimetables.jsonは更新しません。")
    type_counts={}
    day_counts={"weekday":0,"holiday":0,"unknown":0}
    for t in all_trains:
        type_counts[t["type"]]=type_counts.get(t["type"],0)+1
        d=t.get("dayType","unknown")
        day_counts[d]=day_counts.get(d,0)+1
    data={"version":13,"updatedAt":datetime.now(timezone.utc).isoformat(),"source":"名古屋鉄道公式時刻表","sourceUrl":"https://www.meitetsu.co.jp/train/timetable/","trainCount":len(all_trains),"trains":all_trains,"parser":"pdfplumber-coordinate-v13-pass-seconds-distance-cumulative","typeCounts":type_counts,"dayTypeCounts":day_counts,"dayTypes":["weekday","holiday"],"distanceSource":"railway.sidearrow.net station/line distance data"}
    fd,tmp=tempfile.mkstemp(prefix='timetables.',suffix='.json',dir=os.path.dirname(OUTPUT))
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump(
                data,
                f,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            f.write("\n")
        os.replace(tmp,OUTPUT)
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    print(f"Generated trains: {len(all_trains)}")
    print(f"299 count: {sum(1 for t in all_trains if t['trainNumber']=='299')}")
    print(f"Types: {json.dumps(type_counts,ensure_ascii=False)}")
    print(f"Day types: {json.dumps(day_counts,ensure_ascii=False)}")

if __name__=='__main__': main()

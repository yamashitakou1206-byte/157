import os, re, json, hashlib
from datetime import datetime, timezone
import pdfplumber

PDF_DIR = "data/pdfs"
OUTPUT = "data/timetables.json"
TRAIN_TYPES = ["ミュースカイ","快速特急","特急","快速急行","急行","準急","普通"]
TRAIN_NUMBER_RE = re.compile(r"^\d{1,5}[A-Z]?$", re.I)
TIME_RE = re.compile(r"^\d{1,2}:?\d{2}$")
ROUTES = ["名古屋本線","豊川線","津島線","尾西線","竹鼻線","羽島線","常滑線","空港線","河和線","知多新線","犬山線","各務原線","広見線","小牧線","三河線","豊田線","西尾線","蒲郡線","瀬戸線"]
HEADERS = {"列車番号","列車種別","種別","行先","行先駅","発","着","時刻","駅名","駅"}

def clean(v):
    return re.sub(r"\s+", " ", str(v or "").replace("\n"," ").replace("\r"," ")).strip()

def norm_time(v):
    s=clean(v).replace("：",":")
    if re.fullmatch(r"\d{1,2}:\d{2}",s):
        h,m=s.split(":")
        if 0<=int(h)<=29 and 0<=int(m)<=59:return f"{int(h)}:{m}"
    if re.fullmatch(r"\d{3,4}",s):
        h=int(s[:-2]); m=int(s[-2:])
        if 0<=h<=29 and 0<=m<=59:return f"{h}:{m:02d}"
    return ""

def is_num(s): return bool(re.fullmatch(r"\d+(?:\.\d+)?",clean(s)))
def is_train(s): return bool(TRAIN_NUMBER_RE.fullmatch(clean(s)))
def is_time(s): return bool(norm_time(s))

def crew(route):
    if any(x in route for x in ["名古屋本線","豊川線","津島線","尾西線","竹鼻線","羽島線"]): return "名古屋乗務区"
    if any(x in route for x in ["常滑線","空港線","河和線","知多新線"]): return "神宮前乗務区"
    if any(x in route for x in ["犬山線","各務原線","広見線","小牧線"]): return "犬山乗務区"
    if any(x in route for x in ["三河線","豊田線","西尾線","蒲郡線"]): return "知立乗務区"
    if "瀬戸線" in route: return "瀬戸運輸区"
    return ""

def route_from_text(text, filename):
    for r in ROUTES:
        if r in text or r in filename: return r
    return ""

def row_values(row): return [clean(x) for x in (row or [])]

def station_from_row(row):
    vals=row_values(row)
    for v in vals:
        if not v or v in HEADERS or is_time(v) or is_num(v) or is_train(v): continue
        if v in TRAIN_TYPES: continue
        # Track/platform numbers and common PDF symbols are not station names.
        if re.fullmatch(r"[0-9A-Za-z\-+./]+",v): continue
        if len(v)>1: return v
    return ""

def nearby_meta(table, r, c):
    typ=""; dest=""
    # Same row has the strongest relationship in many Meitetsu timetable layouts.
    candidates=[]
    for cc,v in enumerate(row_values(table[r])):
        if cc==c or not v: continue
        candidates.append(v)
    for v in candidates:
        if v in TRAIN_TYPES: typ=v
    # Search a narrow neighborhood, but never scan an entire page for metadata.
    for rr in range(max(0,r-3), min(len(table),r+4)):
        for v in row_values(table[rr]):
            if v in TRAIN_TYPES: typ=v
    # Destination is usually a Japanese station name near the train number.
    for v in candidates:
        if v in HEADERS or v in TRAIN_TYPES or is_time(v) or is_num(v) or is_train(v): continue
        if re.fullmatch(r"[0-9A-Za-z\-+./]+",v): continue
        dest=v; break
    return typ,dest

def extract(table, r0, c0, number, pdf, page, route):
    typ,dest=nearby_meta(table,r0,c0)
    stops=[]
    # Track the same x-column, but reject header/track garbage and stop at another train-number row.
    for r in range(r0+1,len(table)):
        row=table[r] or []
        if any(is_train(x) for x in row): break
        station=station_from_row(row)
        if not station: continue
        if c0>=len(row): continue
        t=norm_time(row[c0])
        if not t: continue
        # Keep chronological sequence; midnight crossings are handled by allowing one wrap.
        if stops:
            prev=sum(map(int,stops[-1]["time"].split(":")))
            cur=sum(map(int,t.split(":")))
            if cur+24*60 < prev: continue
            if cur < prev-5: continue
        stops.append({"station":station,"time":t})
    if len(stops)<2: return None
    if not dest: dest=stops[-1]["station"]
    if not typ: typ="普通"
    # Remove accidental duplicate station/time pairs.
    clean_st=[]
    seen=set()
    for s in stops:
        key=(s["station"],s["time"])
        if key not in seen: clean_st.append(s); seen.add(key)
    if len(clean_st)<2:return None
    ident=hashlib.sha1(f"{number}|{pdf}|{page}|{c0}|{clean_st[0]['time']}|{clean_st[-1]['time']}".encode()).hexdigest()
    return {"id":ident,"trainNumber":number,"type":typ,"origin":clean_st[0]["station"],"destination":dest,"route":route,"crew":crew(route),"pdf":pdf,"page":page,"stops":clean_st}

def parse_pdf(path):
    pdfname=os.path.basename(path); out=[]
    try:
        with pdfplumber.open(path) as pdf:
            for pageno,page in enumerate(pdf.pages,1):
                page_text=clean(page.extract_text() or "")
                route=route_from_text(page_text,pdfname)
                try: tables=page.extract_tables() or []
                except Exception as e:
                    print(f"{pdfname} p{pageno}: table error: {e}"); continue
                for table in tables:
                    for r,row in enumerate(table):
                        for c,cell in enumerate(row or []):
                            n=clean(cell)
                            if not is_train(n): continue
                            train=extract(table,r,c,n,pdfname,pageno,route)
                            if train: out.append(train)
    except Exception as e: print(f"PDF解析エラー {pdfname}: {e}")
    return out

def dedupe(trains):
    seen=set(); out=[]
    for t in trains:
        key=(t["trainNumber"],t["type"],t["origin"],t["destination"],tuple((x["station"],x["time"]) for x in t["stops"]))
        if key not in seen: seen.add(key); out.append(t)
    return out

def main():
    os.makedirs("data",exist_ok=True)
    files=sorted(os.path.join(PDF_DIR,x) for x in os.listdir(PDF_DIR) if x.lower().endswith(".pdf")) if os.path.isdir(PDF_DIR) else []
    all_trains=[]
    for f in files: all_trains.extend(parse_pdf(f))
    all_trains=dedupe(all_trains)
    all_trains.sort(key=lambda x:(int(re.match(r"\d+",x["trainNumber"]).group()) if re.match(r"\d+",x["trainNumber"]) else 999999,x["trainNumber"],x["origin"],x["stops"][0]["time"] if x["stops"] else ""))
    data={"version":4,"updatedAt":datetime.now(timezone.utc).isoformat(),"source":"名古屋鉄道公式時刻表","sourceUrl":"https://www.meitetsu.co.jp/train/timetable/","trainCount":len(all_trains),"trains":all_trains}
    with open(OUTPUT,"w",encoding="utf-8") as f: json.dump(data,f,ensure_ascii=False,indent=2)
    print(f"PDF数: {len(files)} / 列車データ: {len(all_trains)} / 299: {sum(1 for x in all_trains if x['trainNumber']=='299')}")

if __name__=="__main__": main()

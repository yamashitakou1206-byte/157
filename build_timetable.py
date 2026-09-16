import json, re, time, hashlib
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
import fitz

BASE='https://www.meitetsu.co.jp'
INDEX=BASE+'/train/timetable/'
OUT=Path('data/timetables.json')
CACHE=Path('.cache/timetables')
CACHE.mkdir(parents=True, exist_ok=True)

TYPE_WORDS={'μS','μＳ','快特','特急','快急','急行','準急','普通'}
ROUTE_CODES={
 'NH':'名古屋本線','KG':'豊川線','GN':'西尾線・蒲郡線','MY':'三河線','TT':'豊田線・地下鉄鶴舞線',
 'TA':'常滑線・空港線・河和線・知多新線','CH':'築港線','ST':'瀬戸線','TB':'津島線','BS':'尾西線',
 'IY':'犬山線・各務原線','HM':'広見線','KM':'小牧線・地下鉄上飯田線','TH':'竹鼻線・羽島線'
}
TRAIN_RE=re.compile(r'^\d{2,5}[A-Za-z]{0,3}\*?$')
TIME_RE=re.compile(r'^(?:\d{3,4}|\d{1,2}[:.]\d{2}(?::\d{2})?)$')

def clean(s): return re.sub(r'\s+','',s or '').replace('　','').strip()
def norm_time(s):
    s=clean(s).replace('：',':')
    if re.fullmatch(r'\d{3,4}',s):
        s=s.zfill(4); return s[:2]+':'+s[2:]
    m=re.fullmatch(r'(\d{1,2})[:.](\d{2})(?::(\d{2}))?',s)
    return f'{int(m.group(1)):02d}:{m.group(2)}'+(f':{m.group(3)}' if m.group(3) else '') if m else None

def word_center(w): return (w[0]+w[2])/2
def word_y(w): return (w[1]+w[3])/2

def page_lines(page):
    # Group words into visual lines using their y coordinate.
    words=page.get_text('words')
    groups=[]
    for w in sorted(words,key=lambda x:(word_y(x),x[0])):
        y=word_y(w)
        found=None
        for g in groups:
            if abs(g[0]-y)<=3.5: found=g; break
        if found: found[1].append(w); found[0]=(found[0]*len(found[1])+y)/(len(found[1])+1)
        else: groups.append([y,[w]])
    return [sorted(g[1],key=lambda x:x[0]) for g in sorted(groups,key=lambda x:x[0])]

def parse_page(page,meta):
    lines=page_lines(page)
    # Find the visual line containing 列車番号; train number row is normally 1-2 lines above it in the PDF reading order.
    idx=None
    for i,ws in enumerate(lines):
        txt=''.join(w[4] for w in ws)
        if '列車番号' in txt: idx=i; break
    if idx is None: return []
    # Search nearby lines for train-number tokens. Prefer the first line containing 5+ candidates.
    candidates=[]
    for j in range(max(0,idx-8),min(len(lines),idx+8)):
        row=[]
        for w in lines[j]:
            t=clean(w[4])
            if TRAIN_RE.fullmatch(t) and any(ch.isdigit() for ch in t) and word_center(w)<900:
                row.append(w)
        if len(row)>len(candidates): candidates=row
    if not candidates:return []
    trains=[];seen=set()
    for w in sorted(candidates,key=word_center):
        no=clean(w[4]).upper().replace('*','')
        key=(round(word_center(w),1),no)
        if key not in seen:
            seen.add(key);trains.append({'no':no,'x':word_center(w)})
    # Type and destination are in the rows immediately below the train numbers.
    header_i=next((j for j in range(max(0,idx-8),min(len(lines),idx+8)) if len([w for w in lines[j] if TRAIN_RE.fullmatch(clean(w[4]))])>=len(trains)),idx-1)
    def values_for_row(j):
        out=[]
        for tr in trains:
            nearby=[w for w in lines[j] if abs(word_center(w)-tr['x'])<25]
            out.append(clean(nearby[0][4]) if nearby else '')
        return out
    type_vals=values_for_row(min(header_i+1,len(lines)-1))
    dest_vals=values_for_row(min(header_i+2,len(lines)-1))
    for i,tr in enumerate(trains): tr['type']=type_vals[i] if i<len(type_vals) and type_vals[i] in TYPE_WORDS else '';tr['destination']=dest_vals[i] if i<len(dest_vals) else ''

    station_rows=[]
    for ws in lines:
        if not ws: continue
        # Station name is typically the rightmost Japanese text on a timetable row.
        jap=[w for w in ws if re.search(r'[一-龯ぁ-んァ-ヶ]',clean(w[4]))]
        if not jap: continue
        label_words=sorted(jap,key=lambda w:w[0])
        # Exclude header/footer/notes and labels such as 発/着/列車番号.
        raw=clean(''.join(w[4] for w in label_words[-3:]))
        if raw in {'列車番号','種別','行先','始発','終着','記事','前のページ','次のページ'}: continue
        if any(x in raw for x in ['年','改正','時刻表']) or len(raw)>14: continue
        # Only consider labels at the right side of the table.
        label=label_words[-1]
        if word_center(label)<500: continue
        station=raw
        # Remove row markers such as 着/発/〃 when they leak into label.
        station=station.replace('〃','').strip()
        if station in {'着','発'} or not station: continue
        vals=[]
        for tr in trains:
            near=[w for w in ws if abs(word_center(w)-tr['x'])<25]
            tm=''
            for w in near:
                n=norm_time(w[4])
                if n: tm=n; break
            vals.append(tm)
        if any(vals): station_rows.append((station,vals))
    # Keep sequence but deduplicate exact adjacent labels.
    ded=[]
    for st,vals in station_rows:
        if ded and ded[-1][0]==st:
            ded[-1]=(st,[a or b for a,b in zip(ded[-1][1],vals)])
        else: ded.append((st,vals))
    out=[]
    for ti,tr in enumerate(trains):
        stops=[[st,vals[ti]] for st,vals in ded if ti<len(vals) and vals[ti]]
        if stops or tr['destination']:
            out.append({k:v for k,v in {**tr,'page':meta['page'],'pdf':meta['pdf'],'route':meta['route'],'day':meta['day'],'direction':meta['direction']}.items() if k!='x'})
    return out

def infer_meta(url,page_text):
    name=url.rsplit('/',1)[-1]
    m=re.search(r'(?:kai_)?20260314_([A-Z]+)_(W|H)\d+',name)
    code=m.group(1) if m else ''
    day='weekday' if m and m.group(2)=='W' else 'holiday' if m else ('weekday' if '平日' in page_text else 'holiday')
    direction='down' if '下り' in page_text else 'up' if '上り' in page_text else 'unknown'
    return ROUTE_CODES.get(code,code or '名鉄'),day,direction

def main():
    s=requests.Session();s.headers['User-Agent']='Mozilla/5.0 MeitetsuTimetableBuilder/2.0'
    html=s.get(INDEX,timeout=60).text
    soup=BeautifulSoup(html,'html.parser')
    links=[]
    for a in soup.find_all('a',href=True):
        href=a['href'];
        if '.pdf' not in href.lower(): continue
        u=urljoin(BASE,href)
        if u not in [x[0] for x in links]: links.append((u,clean(a.get_text(' ',strip=True))))
    records=[]
    for n,(url,label) in enumerate(links,1):
        path=CACHE/(hashlib.sha1(url.encode()).hexdigest()+'.pdf')
        try:
            if not path.exists() or path.stat().st_size<1000:
                r=s.get(url,timeout=90);r.raise_for_status();path.write_bytes(r.content)
            doc=fitz.open(path)
            for pi,page in enumerate(doc,1):
                txt=page.get_text()[:1200]
                route,day,direction=infer_meta(url,txt)
                records.extend(parse_page(page,{'page':pi,'pdf':url,'route':route,'day':day,'direction':direction}))
            doc.close();print(f'[{n}/{len(links)}] {url}')
        except Exception as e: print('ERROR',url,e)
    merged={}
    for r in records:
        key=(r['no'],r['day'],r['direction'],r['route'])
        m=merged.setdefault(key,{k:r.get(k) for k in ['no','type','destination','route','day','direction','pdf']})
        m.setdefault('stops',[])
        if r.get('type') and not m.get('type'):m['type']=r['type']
        if r.get('destination') and not m.get('destination'):m['destination']=r['destination']
        for st,t in r.get('stops',[]):
            if not any(x[0]==st and x[1]==t for x in m['stops']):m['stops'].append([st,t])
    data={'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'source':INDEX,'timetableRevision':'2026-03-14','trains':list(merged.values())}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2));print('wrote',OUT,'trains',len(data['trains']))
if __name__=='__main__':main()

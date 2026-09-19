import json
import pathlib
import subprocess
import sys
import shutil
import urllib.request
import ssl
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'tools' / 'sources.json'
PDFDIR = ROOT / 'tools' / 'data' / 'pdfs'
OUT = ROOT / 'data' / 'timetables.json'
OUT.parent.mkdir(parents=True, exist_ok=True)
PDFDIR.mkdir(parents=True, exist_ok=True)

items = json.loads(SOURCES.read_text(encoding='utf-8'))
ctx = ssl.create_default_context()

for i, x in enumerate(items, 1):
    fn = x['name'] + '.pdf'
    dst = PDFDIR / fn
    print(f'[{i}/{len(items)}] {x["name"]} {x["route"]}')
    last_error = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(
                x['url'],
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; MeitetsuDriverApp/1.0)',
                    'Accept': 'application/pdf,*/*;q=0.8',
                },
            )
            with urllib.request.urlopen(req, context=ctx, timeout=120) as r, open(dst, 'wb') as f:
                shutil.copyfileobj(r, f)
            size = dst.stat().st_size
            if size < 10_000 or dst.read_bytes()[:4] != b'%PDF':
                raise RuntimeError(f'not a valid PDF (size={size})')
            print(f'  downloaded: {size:,} bytes')
            last_error = None
            break
        except Exception as e:
            last_error = e
            print(f'  attempt {attempt}/3 failed: {e}')
            time.sleep(2 * attempt)
    if last_error is not None:
        raise RuntimeError(f'Download failed: {x["url"]}') from last_error

parser = ROOT / 'tools' / 'build_timetable_fixed_v10.py'
subprocess.run([sys.executable, str(parser)], cwd=ROOT / 'tools', check=True)
shutil.copy2(ROOT / 'tools' / 'data' / 'timetables.json', OUT)

print(f'\nFULL OFFICIAL TIMETABLE DATA READY: {OUT}')

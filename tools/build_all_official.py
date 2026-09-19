import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


# ============================================================
# パス設定
# ============================================================

# リポジトリのルート
ROOT = Path(__file__).resolve().parent.parent

TOOLS_DIR = ROOT / "tools"

SOURCES_FILE = TOOLS_DIR / "sources.json"

PDF_DIR = ROOT / "data" / "pdfs"

OUTPUT = ROOT / "data" / "timetables.json"

PARSER = TOOLS_DIR / "build_timetable_fixed_v11.py"


# ============================================================
# 初期確認
# ============================================================

print("=" * 60)
print("Meitetsu Official Timetable Builder")
print("=" * 60)

print("ROOT       :", ROOT)
print("SOURCES    :", SOURCES_FILE)
print("PDF DIR    :", PDF_DIR)
print("OUTPUT     :", OUTPUT)
print("PARSER     :", PARSER)

print("=" * 60)


if not SOURCES_FILE.exists():
    raise FileNotFoundError(
        f"sources.json が見つかりません: {SOURCES_FILE}"
    )


if not PARSER.exists():
    raise FileNotFoundError(
        f"パーサーが見つかりません: {PARSER}"
    )


# ============================================================
# sources.json 読み込み
# ============================================================

with SOURCES_FILE.open(
    "r",
    encoding="utf-8"
) as f:

    sources_data = json.load(f)


# sources.json が
#
# [
#   {...},
#   {...}
# ]
#
# または
#
# {
#   "sources": [...]
# }
#
# のどちらでも対応
if isinstance(sources_data, dict):

    sources = sources_data.get(
        "sources",
        []
    )

elif isinstance(sources_data, list):

    sources = sources_data

else:

    raise RuntimeError(
        "sources.json の形式が不正です"
    )


if not sources:

    raise RuntimeError(
        "sources.json にPDF情報がありません"
    )


print(
    f"PDF sources: {len(sources)}"
)


# ============================================================
# PDF保存フォルダ作成
# ============================================================

PDF_DIR.mkdir(
    parents=True,
    exist_ok=True
)

OUTPUT.parent.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# 古いPDFを削除
#
# 前回のPDFが残っていると、
# sources.jsonから削除されたPDFまで解析されるため
# 毎回クリーンな状態から作成
# ============================================================

for old_pdf in PDF_DIR.glob("*.pdf"):

    old_pdf.unlink()


# ============================================================
# PDFダウンロード
# ============================================================

print()
print("=" * 60)
print("Downloading official Meitetsu PDFs")
print("=" * 60)


downloaded = 0


for index, source in enumerate(
    sources,
    start=1
):

    if not isinstance(source, dict):
        continue

    code = str(
        source.get("code", "")
        or source.get("id", "")
        or source.get("name", "")
    ).strip()

    name = str(
        source.get("name", "")
        or source.get("title", "")
        or code
    ).strip()

    url = str(
        source.get("url", "")
    ).strip()


    if not url:

        raise RuntimeError(
            f"URLがありません: {source}"
        )


    # ファイル名
    filename = source.get(
        "filename"
    )


    if not filename:

        if code:

            filename = f"{code}.pdf"

        else:

            filename = (
                f"timetable_{index:02d}.pdf"
            )


    if not filename.lower().endswith(
        ".pdf"
    ):

        filename += ".pdf"


    destination = (
        PDF_DIR / filename
    )


    print(
        f"[{index}/{len(sources)}] "
        f"{code} {name}"
    )


    request = urllib.request.Request(
        url,
        headers={
            "User-Agent":
                "Mozilla/5.0 "
                "(GitHub Actions "
                "Meitetsu Timetable Builder)"
        }
    )


    try:

        with urllib.request.urlopen(
            request,
            timeout=60
        ) as response:

            data = response.read()


    except Exception as exc:

        raise RuntimeError(
            f"PDFダウンロード失敗: "
            f"{code} {url}\n{exc}"
        ) from exc


    # PDFとして小さすぎる場合は異常
    if len(data) < 10000:

        raise RuntimeError(
            f"PDFサイズが異常です: "
            f"{code} "
            f"{len(data):,} bytes"
        )


    # PDFヘッダー確認
    if not data.startswith(
        b"%PDF"
    ):

        raise RuntimeError(
            f"PDFではないデータを取得しました: "
            f"{code}"
        )


    destination.write_bytes(
        data
    )


    downloaded += 1


    print(
        f"  downloaded: "
        f"{len(data):,} bytes"
    )


# ============================================================
# ダウンロード結果確認
# ============================================================

print()
print("=" * 60)
print("Download complete")
print("=" * 60)

print(
    f"Downloaded PDFs: {downloaded}"
)


if downloaded != len(sources):

    raise RuntimeError(
        "一部PDFをダウンロードできませんでした "
        f"({downloaded}/{len(sources)})"
    )


actual_pdfs = list(
    PDF_DIR.glob("*.pdf")
)


print(
    f"PDF files on disk: "
    f"{len(actual_pdfs)}"
)


if len(actual_pdfs) != len(sources):

    raise RuntimeError(
        "PDFファイル数が一致しません "
        f"expected={len(sources)} "
        f"actual={len(actual_pdfs)}"
    )


# ============================================================
# 古いJSONを一時退避
#
# v11の解析に失敗した場合に、
# 壊れたJSONを正常データとして扱わないため
# ============================================================

backup = None


if OUTPUT.exists():

    backup = OUTPUT.with_suffix(
        ".json.backup"
    )

    shutil.copy2(
        OUTPUT,
        backup
    )


# ============================================================
# v11パーサー実行
# ============================================================

print()
print("=" * 60)
print("Running timetable parser v11")
print("=" * 60)


try:

    subprocess.run(
        [
            sys.executable,
            str(PARSER)
        ],
        cwd=str(ROOT),
        check=True
    )


except subprocess.CalledProcessError:

    print()
    print(
        "ERROR: v11 parser failed"
    )

    # パーサーが途中でOUTPUTを壊した場合は
    # 元データへ戻す
    if backup and backup.exists():

        shutil.copy2(
            backup,
            OUTPUT
        )

        print(
            "Previous timetables.json restored."
        )

    raise


# ============================================================
# 出力確認
#
# 重要:
# tools/data/timetables.json ではありません。
#
# 正しい場所:
# data/timetables.json
# ============================================================

if not OUTPUT.exists():

    if backup and backup.exists():

        shutil.copy2(
            backup,
            OUTPUT
        )

    raise FileNotFoundError(
        "パーサー実行後も "
        "data/timetables.json "
        "が生成されませんでした"
    )


# ============================================================
# JSONとして読み込めるか確認
# ============================================================

try:

    with OUTPUT.open(
        "r",
        encoding="utf-8"
    ) as f:

        result = json.load(f)


except Exception as exc:

    if backup and backup.exists():

        shutil.copy2(
            backup,
            OUTPUT
        )

    raise RuntimeError(
        "生成されたtimetables.jsonを"
        "読み込めません"
    ) from exc


# ============================================================
# 基本検証
# ============================================================

trains = result.get(
    "trains",
    []
)


if not isinstance(
    trains,
    list
):

    raise RuntimeError(
        "trains が配列ではありません"
    )


train_count = len(
    trains
)


print()
print("=" * 60)
print("Generated timetable validation")
print("=" * 60)

print(
    f"Generated trains: "
    f"{train_count}"
)


# 全60PDFを解析するため、
# 極端に少ない場合は異常
if train_count < 5000:

    if backup and backup.exists():

        shutil.copy2(
            backup,
            OUTPUT
        )

    raise RuntimeError(
        "解析された列車数が少なすぎます: "
        f"{train_count}"
    )


# ============================================================
# 種別集計
# ============================================================

type_counts = {}


for train in trains:

    train_type = str(
        train.get(
            "type",
            ""
        )
    ).strip()


    if train_type:

        type_counts[
            train_type
        ] = (
            type_counts.get(
                train_type,
                0
            )
            + 1
        )


print(
    "Types:",
    json.dumps(
        type_counts,
        ensure_ascii=False
    )
)


# ============================================================
# 平日 / 土休日集計
# ============================================================

day_counts = {
    "weekday": 0,
    "holiday": 0,
    "unknown": 0
}


for train in trains:

    day_type = train.get(
        "dayType",
        "unknown"
    )


    if day_type not in day_counts:

        day_type = "unknown"


    day_counts[
        day_type
    ] += 1


print(
    "Day types:",
    json.dumps(
        day_counts,
        ensure_ascii=False
    )
)


# ============================================================
# 列車番号299の確認
# ============================================================

train_299 = [
    train
    for train in trains
    if str(
        train.get(
            "trainNumber",
            ""
        )
    ) == "299"
]


print(
    f"299 count: "
    f"{len(train_299)}"
)


# ============================================================
# バックアップ削除
# ============================================================

if (
    backup
    and backup.exists()
):

    backup.unlink()


# ============================================================
# 完了
# ============================================================

print()
print("=" * 60)
print("SUCCESS")
print("=" * 60)

print(
    "Timetable generated:"
)

print(
    OUTPUT
)

print(
    f"Size: "
    f"{OUTPUT.stat().st_size:,} bytes"
)

print("=" * 60)

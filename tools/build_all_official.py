#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import subprocess
import sys
import urllib.request
from pathlib import Path


# ============================================================
# パス設定
# ============================================================

ROOT = Path(__file__).resolve().parents[1]

TOOLS_DIR = ROOT / "tools"
DATA_DIR = ROOT / "data"
PDF_DIR = DATA_DIR / "pdfs"

SOURCES_FILE = TOOLS_DIR / "sources.json"

# v12を使用
PARSER = TOOLS_DIR / "build_timetable_fixed_v12.py"

# v12が直接ここへ生成する
OUTPUT = DATA_DIR / "timetables.json"


# ============================================================
# sources.json の読み込み
# ============================================================

def load_sources():
    if not SOURCES_FILE.exists():
        raise FileNotFoundError(
            f"sources.json が見つかりません: {SOURCES_FILE}"
        )

    with SOURCES_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        sources = data

    elif isinstance(data, dict):
        sources = data.get("sources", [])

    else:
        raise RuntimeError(
            "sources.json の形式が不正です"
        )

    if not sources:
        raise RuntimeError(
            "sources.json にPDF情報がありません"
        )

    return sources


# ============================================================
# source情報から値を取得
# ============================================================

def source_value(source, *names):
    for name in names:
        value = source.get(name)

        if value not in (None, ""):
            return str(value).strip()

    return ""


# ============================================================
# PDFファイル名
# ============================================================

def source_filename(source, index):
    filename = source_value(
        source,
        "filename",
        "file",
        "pdf"
    )

    # pdf がURLだった場合は
    # ファイル名として使用しない
    if filename.startswith(
        ("http://", "https://")
    ):
        filename = ""

    if filename:
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"

        return filename

    code = source_value(
        source,
        "code",
        "id",
        "key"
    )

    if code:
        return f"{code}.pdf"

    return f"timetable_{index:02d}.pdf"


# ============================================================
# PDFダウンロード
# ============================================================

def download_pdfs(sources):
    PDF_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    # ----------------------------------------
    # 古いPDF削除
    #
    # 前回のPDFが残っていると
    # v12が余計なPDFまで解析してしまうため
    # 毎回クリーンにする
    # ----------------------------------------

    for old_pdf in PDF_DIR.glob("*.pdf"):
        old_pdf.unlink()

    print()
    print("=" * 72)
    print(
        "Downloading official "
        "Meitetsu timetable PDFs"
    )
    print("=" * 72)

    downloaded = 0

    for index, source in enumerate(
        sources,
        start=1
    ):

        if not isinstance(source, dict):
            raise RuntimeError(
                f"sources.json の "
                f"{index} 件目が"
                f"オブジェクトではありません"
            )

        url = source_value(
            source,
            "url",
            "pdfUrl",
            "pdf_url",
            "downloadUrl"
        )

        # pdfキーそのものがURLの場合にも対応
        if not url:
            pdf_value = source_value(
                source,
                "pdf"
            )

            if pdf_value.startswith(
                ("http://", "https://")
            ):
                url = pdf_value

        if not url:
            raise RuntimeError(
                f"{index} 件目の"
                f"PDF URLがありません:\n"
                f"{source}"
            )

        filename = source_filename(
            source,
            index
        )

        destination = (
            PDF_DIR / filename
        )

        code = source_value(
            source,
            "code",
            "id",
            "key"
        )

        name = source_value(
            source,
            "name",
            "title",
            "label"
        )

        label = " ".join(
            value
            for value in (code, name)
            if value
        )

        if not label:
            label = filename

        print(
            f"[{index}/{len(sources)}] "
            f"{label}"
        )

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "Mozilla/5.0 "
                    "(GitHub Actions; "
                    "Meitetsu timetable builder)"
            }
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=90
            ) as response:

                data = response.read()

        except Exception as exc:
            raise RuntimeError(
                "PDFダウンロード失敗:\n"
                f"{url}\n"
                f"{exc}"
            ) from exc

        # ----------------------------------------
        # HTMLエラーページなどを
        # PDFとして保存しない
        # ----------------------------------------

        if not data.startswith(b"%PDF"):
            raise RuntimeError(
                "取得したデータが"
                "PDFではありません:\n"
                f"{url}"
            )

        # 極端に小さいPDFは異常扱い
        if len(data) < 10_000:
            raise RuntimeError(
                "PDFサイズが小さすぎます: "
                f"{filename} "
                f"({len(data):,} bytes)"
            )

        destination.write_bytes(data)

        downloaded += 1

        print(
            "  downloaded: "
            f"{len(data):,} bytes"
        )

    actual = list(
        PDF_DIR.glob("*.pdf")
    )

    print()
    print(
        f"Downloaded PDFs: {downloaded}"
    )

    print(
        "PDF files on disk: "
        f"{len(actual)}"
    )

    if downloaded != len(sources):
        raise RuntimeError(
            "PDFダウンロード数が"
            "一致しません: "
            f"{downloaded}/"
            f"{len(sources)}"
        )

    if len(actual) != len(sources):
        raise RuntimeError(
            "保存されたPDF数が"
            "一致しません: "
            f"{len(actual)}/"
            f"{len(sources)}"
        )


# ============================================================
# v12パーサー実行
# ============================================================

def run_parser():

    if not PARSER.exists():
        raise FileNotFoundError(
            "v12パーサーが"
            "見つかりません:\n"
            f"{PARSER}"
        )

    print()
    print("=" * 72)
    print(
        "Running timetable parser v12"
    )
    print("=" * 72)

    # ----------------------------------------
    # 古いJSONが残った状態で
    # 成功扱いになることを防ぐ
    # ----------------------------------------

    if OUTPUT.exists():
        OUTPUT.unlink()

    subprocess.run(
        [
            sys.executable,
            str(PARSER)
        ],
        cwd=str(ROOT),
        check=True
    )

    if not OUTPUT.exists():
        raise FileNotFoundError(
            "v12の実行後も "
            "data/timetables.json "
            "が生成されませんでした"
        )


# ============================================================
# 生成JSON検証
# ============================================================

def validate_output():

    print()
    print("=" * 72)
    print(
        "Validating generated timetable"
    )
    print("=" * 72)

    try:
        with OUTPUT.open(
            "r",
            encoding="utf-8"
        ) as f:

            result = json.load(f)

    except Exception as exc:
        raise RuntimeError(
            "生成された "
            "data/timetables.json を"
            "読み込めません"
        ) from exc

    trains = result.get("trains")

    if not isinstance(trains, list):
        raise RuntimeError(
            "timetables.json の "
            "trains が配列ではありません"
        )

    count = len(trains)

    # 全路線解析なので
    # あまりにも少ない場合は異常
    if count < 1000:
        raise RuntimeError(
            "生成列車数が"
            "少なすぎます: "
            f"{count}"
        )

    type_counts = {}
    day_counts = {}

    invalid_type = 0
    invalid_stops = 0

    valid_types = {
        "普通",
        "準急",
        "急行",
        "快速急行",
        "特急",
        "快速特急",
        "ミュースカイ",
    }

    # ----------------------------------------
    # 全列車チェック
    # ----------------------------------------

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

        if train_type not in valid_types:
            invalid_type += 1

        day_type = str(
            train.get(
                "dayType",
                "unknown"
            )
        )

        day_counts[
            day_type
        ] = (
            day_counts.get(
                day_type,
                0
            )
            + 1
        )

        stops = train.get("stops")

        if (
            not isinstance(stops, list)
            or len(stops) < 2
        ):
            invalid_stops += 1

    # ----------------------------------------
    # 結果表示
    # ----------------------------------------

    print(
        f"Generated trains: {count}"
    )

    print(
        "Types:",
        json.dumps(
            type_counts,
            ensure_ascii=False,
            sort_keys=True
        )
    )

    print(
        "Day types:",
        json.dumps(
            day_counts,
            ensure_ascii=False,
            sort_keys=True
        )
    )

    print(
        "Invalid types: "
        f"{invalid_type}"
    )

    print(
        "Invalid stop lists: "
        f"{invalid_stops}"
    )

    # ----------------------------------------
    # 不正データがあれば
    # Pagesへ公開させない
    # ----------------------------------------

    if invalid_type:
        raise RuntimeError(
            "不正な種別を持つ列車が "
            f"{invalid_type} 件あります"
        )

    if invalid_stops:
        raise RuntimeError(
            "停車駅データが不正な列車が "
            f"{invalid_stops} 件あります"
        )

    # ----------------------------------------
    # 本当にv12が生成したJSONか確認
    # ----------------------------------------

    version = result.get("version")

    if version != 12:
        raise RuntimeError(
            "生成JSONのversionが"
            "12ではありません: "
            f"{version}"
        )

    print()
    print("=" * 72)
    print("SUCCESS")
    print("=" * 72)

    print(
        f"Output: {OUTPUT}"
    )

    print(
        "Size: "
        f"{OUTPUT.stat().st_size:,} bytes"
    )


# ============================================================
# main
# ============================================================

def main():

    print("=" * 72)
    print(
        "Meitetsu Official "
        "Timetable Builder"
    )
    print("Parser: v12")
    print("=" * 72)

    print(
        f"ROOT    : {ROOT}"
    )

    print(
        f"SOURCES : {SOURCES_FILE}"
    )

    print(
        f"PDF DIR : {PDF_DIR}"
    )

    print(
        f"PARSER  : {PARSER}"
    )

    print(
        f"OUTPUT  : {OUTPUT}"
    )

    # ----------------------------------------
    # sources.json
    # ----------------------------------------

    sources = load_sources()

    print(
        "PDF sources: "
        f"{len(sources)}"
    )

    # ----------------------------------------
    # 公式PDF取得
    # ----------------------------------------

    download_pdfs(
        sources
    )

    # ----------------------------------------
    # v12解析
    # ----------------------------------------

    run_parser()

    # ----------------------------------------
    # JSON検証
    # ----------------------------------------

    validate_output()


# ============================================================
# 実行
# ============================================================

if __name__ == "__main__":
    main()

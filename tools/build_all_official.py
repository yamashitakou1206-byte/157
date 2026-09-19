#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import subprocess
import sys
import time
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

# v12パーサー
PARSER = TOOLS_DIR / "build_timetable_fixed_v12.py"

# v12の出力先
OUTPUT = DATA_DIR / "timetables.json"


# ============================================================
# sources.json 読み込み
# ============================================================

def load_sources():

    if not SOURCES_FILE.exists():
        raise FileNotFoundError(
            f"sources.json が見つかりません: "
            f"{SOURCES_FILE}"
        )

    with SOURCES_FILE.open(
        "r",
        encoding="utf-8"
    ) as f:

        data = json.load(f)

    if isinstance(data, list):

        sources = data

    elif isinstance(data, dict):

        sources = data.get(
            "sources",
            []
        )

    else:

        raise RuntimeError(
            "sources.json の形式が不正です"
        )

    if not sources:

        raise RuntimeError(
            "sources.json に"
            "PDF情報がありません"
        )

    return sources


# ============================================================
# sourceから値取得
# ============================================================

def source_value(source, *names):

    for name in names:

        value = source.get(name)

        if value not in (
            None,
            ""
        ):
            return str(value).strip()

    return ""


# ============================================================
# PDFファイル名取得
# ============================================================

def source_filename(
    source,
    index
):

    filename = source_value(
        source,
        "filename",
        "file",
        "pdf"
    )

    # pdfキーがURLなら
    # ファイル名として使用しない
    if filename.startswith(
        (
            "http://",
            "https://"
        )
    ):
        filename = ""

    if filename:

        if not filename.lower().endswith(
            ".pdf"
        ):
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

    return (
        f"timetable_"
        f"{index:02d}.pdf"
    )


# ============================================================
# PDFが正常か確認
# ============================================================

def is_valid_pdf(path):

    if not path.exists():
        return False

    try:

        if path.stat().st_size < 10_000:
            return False

        with path.open("rb") as f:

            header = f.read(4)

        return header == b"%PDF"

    except Exception:

        return False


# ============================================================
# 1本のPDFをダウンロード
# ============================================================

def download_one_pdf(
    url,
    destination,
    label,
    max_attempts=5
):

    last_error = None

    for attempt in range(
        1,
        max_attempts + 1
    ):

        print(
            f"  attempt "
            f"{attempt}/{max_attempts}"
        )

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "Mozilla/5.0 "
                    "(Windows NT 10.0; "
                    "Win64; x64) "
                    "AppleWebKit/537.36 "
                    "(KHTML, like Gecko) "
                    "Chrome/140.0 "
                    "Safari/537.36",

                "Accept":
                    "application/pdf,"
                    "application/octet-stream,"
                    "*/*",

                "Accept-Language":
                    "ja,en-US;q=0.9,"
                    "en;q=0.8",

                "Connection":
                    "close",
            }
        )

        try:

            with urllib.request.urlopen(
                request,
                timeout=180
            ) as response:

                data = response.read()

            # ------------------------------------
            # PDFチェック
            # ------------------------------------

            if not data.startswith(
                b"%PDF"
            ):

                raise RuntimeError(
                    "取得したデータが"
                    "PDFではありません"
                )

            if len(data) < 10_000:

                raise RuntimeError(
                    "PDFサイズが"
                    "小さすぎます: "
                    f"{len(data):,} bytes"
                )

            # ------------------------------------
            # 一時ファイルに保存
            # ------------------------------------

            temp_file = (
                destination.with_suffix(
                    destination.suffix
                    + ".tmp"
                )
            )

            temp_file.write_bytes(
                data
            )

            # 念のため確認
            if not temp_file.exists():

                raise RuntimeError(
                    "一時PDFの保存に"
                    "失敗しました"
                )

            if (
                temp_file.stat().st_size
                < 10_000
            ):

                raise RuntimeError(
                    "保存されたPDFが"
                    "小さすぎます"
                )

            # ------------------------------------
            # 正式ファイルへ置換
            # ------------------------------------

            temp_file.replace(
                destination
            )

            print(
                "  downloaded: "
                f"{len(data):,} bytes"
            )

            return len(data)

        except Exception as exc:

            last_error = exc

            print(
                "  download failed: "
                f"{exc}"
            )

            # 一時ファイル削除
            temp_file = (
                destination.with_suffix(
                    destination.suffix
                    + ".tmp"
                )
            )

            if temp_file.exists():

                try:
                    temp_file.unlink()
                except Exception:
                    pass

            if attempt < max_attempts:

                # 5 → 10 → 15 → 20秒
                wait_seconds = (
                    attempt * 5
                )

                print(
                    "  retry after "
                    f"{wait_seconds} sec..."
                )

                time.sleep(
                    wait_seconds
                )

    raise RuntimeError(
        "PDFダウンロード失敗\n"
        f"対象: {label}\n"
        f"URL: {url}\n"
        f"{max_attempts}回試行しましたが"
        "取得できませんでした。\n"
        f"最後のエラー: {last_error}"
    )


# ============================================================
# 全公式PDF取得
# ============================================================

def download_pdfs(sources):

    PDF_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    print()
    print("=" * 72)
    print(
        "Downloading official "
        "Meitetsu timetable PDFs"
    )
    print("=" * 72)

    downloaded = 0
    reused = 0

    total = len(sources)

    expected_files = set()

    for index, source in enumerate(
        sources,
        start=1
    ):

        if not isinstance(
            source,
            dict
        ):

            raise RuntimeError(
                f"sources.json の "
                f"{index} 件目が"
                "オブジェクトではありません"
            )

        # ----------------------------------------
        # URL取得
        # ----------------------------------------

        url = source_value(
            source,
            "url",
            "pdfUrl",
            "pdf_url",
            "downloadUrl"
        )

        # pdfキー自体がURLの場合
        if not url:

            pdf_value = source_value(
                source,
                "pdf"
            )

            if pdf_value.startswith(
                (
                    "http://",
                    "https://"
                )
            ):

                url = pdf_value

        if not url:

            raise RuntimeError(
                f"{index} 件目の"
                "PDF URLがありません:\n"
                f"{source}"
            )

        # ----------------------------------------
        # ファイル名
        # ----------------------------------------

        filename = source_filename(
            source,
            index
        )

        expected_files.add(
            filename
        )

        destination = (
            PDF_DIR / filename
        )

        # ----------------------------------------
        # 表示名
        # ----------------------------------------

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
            for value in (
                code,
                name
            )
            if value
        )

        if not label:

            label = filename

        print(
            f"[{index}/{total}] "
            f"{label}"
        )

        # ----------------------------------------
        # 既存PDFが正常なら再利用
        # ----------------------------------------

        if is_valid_pdf(
            destination
        ):

            size = (
                destination
                .stat()
                .st_size
            )

            print(
                "  existing PDF reused: "
                f"{size:,} bytes"
            )

            reused += 1

            continue

        # ----------------------------------------
        # 壊れた既存ファイルを削除
        # ----------------------------------------

        if destination.exists():

            try:

                destination.unlink()

            except Exception as exc:

                raise RuntimeError(
                    "壊れたPDFを"
                    "削除できません:\n"
                    f"{destination}\n"
                    f"{exc}"
                ) from exc

        # ----------------------------------------
        # ダウンロード
        # ----------------------------------------

        download_one_pdf(
            url=url,
            destination=destination,
            label=label,
            max_attempts=5
        )

        downloaded += 1

        # ----------------------------------------
        # 連続アクセスを少し抑える
        # ----------------------------------------

        time.sleep(1)

    # ========================================================
    # sources.json に無い古いPDFを削除
    # ========================================================

    for pdf in PDF_DIR.glob(
        "*.pdf"
    ):

        if pdf.name not in expected_files:

            print(
                "Removing old PDF: "
                f"{pdf.name}"
            )

            pdf.unlink()

    # ========================================================
    # 最終確認
    # ========================================================

    actual = list(
        PDF_DIR.glob("*.pdf")
    )

    valid_count = 0

    for pdf in actual:

        if is_valid_pdf(pdf):
            valid_count += 1

    print()
    print("=" * 72)
    print(
        "PDF download result"
    )
    print("=" * 72)

    print(
        f"New downloads : {downloaded}"
    )

    print(
        f"Reused        : {reused}"
    )

    print(
        f"PDF files     : {len(actual)}"
    )

    print(
        f"Valid PDFs    : {valid_count}"
    )

    if valid_count != total:

        raise RuntimeError(
            "必要なPDFが"
            "すべて揃っていません: "
            f"{valid_count}/{total}"
        )

    print(
        "All official PDFs are ready."
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
    # 古いJSONを削除
    # ----------------------------------------

    if OUTPUT.exists():

        OUTPUT.unlink()

    # ----------------------------------------
    # v12実行
    # ----------------------------------------

    subprocess.run(
        [
            sys.executable,
            str(PARSER)
        ],
        cwd=str(ROOT),
        check=True
    )

    # ----------------------------------------
    # 出力確認
    # ----------------------------------------

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

    # ----------------------------------------
    # version
    # ----------------------------------------

    version = result.get(
        "version"
    )

    if version != 12:

        raise RuntimeError(
            "生成JSONのversionが"
            "12ではありません: "
            f"{version}"
        )

    # ----------------------------------------
    # trains
    # ----------------------------------------

    trains = result.get(
        "trains"
    )

    if not isinstance(
        trains,
        list
    ):

        raise RuntimeError(
            "timetables.json の "
            "trains が配列ではありません"
        )

    count = len(
        trains
    )

    # 初回v12診断用
    if count < 1000:

        raise RuntimeError(
            "生成列車数が"
            "少なすぎます: "
            f"{count}"
        )

    # ----------------------------------------
    # 種別
    # ----------------------------------------

    valid_types = {
        "普通",
        "準急",
        "急行",
        "快速急行",
        "特急",
        "快速特急",
        "ミュースカイ",
    }

    type_counts = {}
    day_counts = {}

    invalid_type = 0
    invalid_stops = 0

    # ----------------------------------------
    # 全列車検査
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

        if (
            train_type
            not in valid_types
        ):

            invalid_type += 1

        # ------------------------------------
        # 平日・土休日
        # ------------------------------------

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

        # ------------------------------------
        # 停車駅
        # ------------------------------------

        stops = train.get(
            "stops"
        )

        if (
            not isinstance(
                stops,
                list
            )
            or len(stops) < 2
        ):

            invalid_stops += 1

    # ========================================================
    # 結果
    # ========================================================

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
    # 不正データがある場合
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

    # ========================================================
    # 成功
    # ========================================================

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
    print(
        "Parser: v12"
    )
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
    # sources.json 読込
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
    # 出力検証
    # ----------------------------------------

    validate_output()


# ============================================================
# 実行
# ============================================================

if __name__ == "__main__":
    main()

import os
import re
import json
import hashlib
from datetime import datetime, timezone

import pdfplumber


PDF_DIR = "data/pdfs"
OUTPUT = "data/timetables.json"

TRAIN_NUMBER_RE = re.compile(r"^\d{1,5}[A-Z]?$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$|^\d{3,4}$")


def clean_text(value):
    if value is None:
        return ""

    value = str(value)
    value = value.replace("\n", " ")
    value = value.replace("\r", " ")
    value = re.sub(r"\s+", " ", value)

    return value.strip()


def normalize_time(value):
    """
    PDFから取得した時刻を HH:MM に統一する。
    例:
      530   -> 5:30
      1234  -> 12:34
      5:30  -> 5:30
    """
    value = clean_text(value)

    if not value:
        return ""

    if re.match(r"^\d{1,2}:\d{2}$", value):
        h, m = value.split(":")
        return f"{int(h)}:{m}"

    if re.match(r"^\d{3,4}$", value):
        if len(value) == 3:
            h = int(value[0])
            m = value[1:]
        else:
            h = int(value[:2])
            m = value[2:]

        if 0 <= h <= 29 and 0 <= int(m) <= 59:
            return f"{h}:{m}"

    return ""


def is_train_number(value):
    value = clean_text(value)

    if not value:
        return False

    return bool(TRAIN_NUMBER_RE.match(value))


def is_time(value):
    return bool(normalize_time(value))


def detect_train_numbers(table):
    """
    表の中から列車番号を含むセルを探す。
    戻り値:
      [
        {
          "row": 行番号,
          "col": 列番号,
          "number": "299"
        }
      ]
    """

    found = []

    for r, row in enumerate(table):
        if not row:
            continue

        for c, cell in enumerate(row):
            text = clean_text(cell)

            if not is_train_number(text):
                continue

            found.append(
                {
                    "row": r,
                    "col": c,
                    "number": text,
                }
            )

    return found


def find_row_by_keywords(table, keywords, start_row=0, end_row=None):
    if end_row is None:
        end_row = len(table)

    for r in range(start_row, min(end_row, len(table))):
        row = table[r]

        joined = " ".join(clean_text(x) for x in row if x is not None)

        for keyword in keywords:
            if keyword in joined:
                return r

    return None


def get_cell(table, row, col):
    if row < 0 or row >= len(table):
        return ""

    current = table[row]

    if col < 0 or col >= len(current):
        return ""

    return clean_text(current[col])


def extract_station_name(row):
    """
    駅名が左側にある一般的なPDF表を想定。
    """
    if not row:
        return ""

    values = [clean_text(x) for x in row]

    # 空欄を除外
    values = [x for x in values if x]

    if not values:
        return ""

    return values[0]


def extract_route_from_filename(filename):
    """
    PDFファイル名から路線を推定できる場合だけ使用。
    ハッシュ名の場合は空文字。
    """
    name = filename

    route_keywords = [
        "名古屋本線",
        "豊川線",
        "津島線",
        "尾西線",
        "竹鼻線",
        "羽島線",
        "常滑線",
        "空港線",
        "河和線",
        "知多新線",
        "犬山線",
        "各務原線",
        "広見線",
        "小牧線",
        "三河線",
        "豊田線",
        "西尾線",
        "蒲郡線",
        "瀬戸線",
    ]

    for route in route_keywords:
        if route in name:
            return route

    return ""


def crew_for_route(route):
    if not route:
        return ""

    if any(
        x in route
        for x in [
            "名古屋本線",
            "豊川線",
            "津島線",
            "尾西線",
            "竹鼻線",
            "羽島線",
        ]
    ):
        return "名古屋乗務区"

    if any(
        x in route
        for x in [
            "常滑線",
            "空港線",
            "河和線",
            "知多新線",
        ]
    ):
        return "神宮前乗務区"

    if any(
        x in route
        for x in [
            "犬山線",
            "各務原線",
            "広見線",
            "小牧線",
        ]
    ):
        return "犬山乗務区"

    if any(
        x in route
        for x in [
            "三河線",
            "豊田線",
            "西尾線",
            "蒲郡線",
        ]
    ):
        return "知立乗務区"

    if "瀬戸線" in route:
        return "瀬戸運輸区"

    return ""


def extract_train_from_column(
    table,
    train_row,
    train_col,
    train_number,
    pdf_name,
    page_number,
):
    """
    列車番号が見つかった列を縦方向に追跡する。
    """

    train_type = ""
    destination = ""
    origin = ""
    stops = []

    # 列車番号より下側を解析
    start = train_row + 1

    # 種別・行先を探す
    for r in range(start, min(start + 8, len(table))):
        value = get_cell(table, r, train_col)

        if not value:
            continue

        # 時刻なら種別・行先ではない
        if is_time(value):
            continue

        # よくある種別
        if value in [
            "ミュースカイ",
            "快速特急",
            "特急",
            "快速急行",
            "急行",
            "準急",
            "普通",
        ]:
            train_type = value
            continue

        # 「種別」という文字そのものは除外
        if value in ["種別", "列車種別", "列車"]:
            continue

        # 行先候補
        if not destination:
            destination = value

    # 駅・時刻を解析
    for r in range(start, len(table)):
        row = table[r]

        if not row:
            continue

        station = extract_station_name(row)

        if not station:
            continue

        # 列車番号そのものが再び現れたら別の列車
        if station == train_number:
            continue

        time_value = get_cell(table, r, train_col)
        time_value = normalize_time(time_value)

        if not time_value:
            continue

        # 駅名として明らかに不適切なものを除外
        if station in [
            "列車番号",
            "種別",
            "行先",
            "発",
            "着",
            "時刻",
        ]:
            continue

        stops.append(
            {
                "station": station,
                "time": time_value,
            }
        )

    # 最初の停車駅を始発駅として扱う
    if stops:
        origin = stops[0]["station"]

    if not destination and stops:
        destination = stops[-1]["station"]

    return {
        "id": hashlib.sha1(
            f"{train_number}|{pdf_name}|{page_number}|{train_col}".encode(
                "utf-8"
            )
        ).hexdigest(),
        "trainNumber": train_number,
        "type": train_type,
        "origin": origin,
        "destination": destination,
        "route": extract_route_from_filename(pdf_name),
        "crew": crew_for_route(extract_route_from_filename(pdf_name)),
        "pdf": pdf_name,
        "page": page_number,
        "stops": stops,
    }


def parse_pdf(pdf_path):
    trains = []

    pdf_name = os.path.basename(pdf_path)

    print(f"解析中: {pdf_name}")

    try:
        with pdfplumber.open(pdf_path) as pdf:

            for page_index, page in enumerate(pdf.pages, start=1):

                try:
                    tables = page.extract_tables()
                except Exception as e:
                    print(
                        f"  ページ {page_index}: table解析失敗: {e}"
                    )
                    continue

                if not tables:
                    continue

                for table in tables:

                    if not table:
                        continue

                    found = detect_train_numbers(table)

                    if not found:
                        continue

                    for item in found:

                        train_number = item["number"]

                        # 299を発見した場合はログに表示
                        if train_number == "299":
                            print(
                                f"  ★ 299発見: "
                                f"{pdf_name} page={page_index} "
                                f"row={item['row']} "
                                f"col={item['col']}"
                            )

                        train = extract_train_from_column(
                            table=table,
                            train_row=item["row"],
                            train_col=item["col"],
                            train_number=train_number,
                            pdf_name=pdf_name,
                            page_number=page_index,
                        )

                        # 何らかの駅・時刻が取れたものだけ登録
                        if train["stops"]:
                            trains.append(train)

    except Exception as e:
        print(f"PDF解析エラー: {pdf_name}: {e}")

    return trains


def deduplicate(trains):
    """
    同じ列車データの重複を除去。
    """
    result = []
    seen = set()

    for train in trains:

        key = (
            train.get("trainNumber", ""),
            train.get("type", ""),
            train.get("origin", ""),
            train.get("destination", ""),
            tuple(
                (
                    x.get("station", ""),
                    x.get("time", ""),
                )
                for x in train.get("stops", [])
            ),
        )

        if key in seen:
            continue

        seen.add(key)
        result.append(train)

    return result


def main():

    os.makedirs("data", exist_ok=True)

    if not os.path.isdir(PDF_DIR):
        print(f"PDFフォルダがありません: {PDF_DIR}")
        return

    pdf_files = [
        os.path.join(PDF_DIR, name)
        for name in os.listdir(PDF_DIR)
        if name.lower().endswith(".pdf")
    ]

    pdf_files.sort()

    print(f"PDF数: {len(pdf_files)}")

    all_trains = []

    for pdf_path in pdf_files:
        trains = parse_pdf(pdf_path)
        all_trains.extend(trains)

    all_trains = deduplicate(all_trains)

    # 列車番号順に並べる
    all_trains.sort(
        key=lambda x: (
            x.get("trainNumber", ""),
            x.get("pdf", ""),
            x.get("page", 0),
        )
    )

    output = {
        "version": 3,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "名古屋鉄道公式時刻表",
        "sourceUrl": "https://www.meitetsu.co.jp/train/timetable/",
        "trainCount": len(all_trains),
        "trains": all_trains,
    }

    with open(
        OUTPUT,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            output,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print()
    print("======================================")
    print(f"列車データ: {len(all_trains)}件")
    print(f"出力: {OUTPUT}")
    print("======================================")

    # 299の最終確認
    train_299 = [
        x
        for x in all_trains
        if x.get("trainNumber") == "299"
    ]

    print()
    print(f"299の登録件数: {len(train_299)}")

    for train in train_299[:10]:
        print(
            "299:",
            train.get("type"),
            train.get("origin"),
            "→",
            train.get("destination"),
            "停車駅",
            len(train.get("stops", [])),
            "駅",
        )


if __name__ == "__main__":
    main()

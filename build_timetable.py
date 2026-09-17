import io
import json
import os
import re
import hashlib
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests
import pdfplumber
from bs4 import BeautifulSoup


INDEX_URL = "https://www.meitetsu.co.jp/train/timetable/"
OUTPUT = "data/timetables.json"
PDF_DIR = "work/pdfs"

os.makedirs(PDF_DIR, exist_ok=True)
os.makedirs("data", exist_ok=True)

session = requests.Session()

session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 "
        "(Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 "
        "Chrome/140 Safari/537.36"
    )
})


def clean(value):
    if value is None:
        return ""

    return re.sub(
        r"\s+",
        "",
        str(value)
    ).strip()


def is_train_number(value):
    """
    名鉄の列車番号らしい文字列か判定
    例:
      299
      299A
      1980S
      1071A
    """

    value = clean(value)

    return bool(
        re.fullmatch(
            r"\d{2,5}[A-Z]?",
            value
        )
    )


def normalize_time(value):
    """
    PDFから取得した時刻をHH:MMへ統一
    """

    value = clean(value)

    value = (
        value
        .replace("：", ":")
        .replace(".", ":")
    )

    # 12:34
    if re.fullmatch(
        r"\d{1,2}:\d{2}",
        value
    ):
        hour, minute = map(
            int,
            value.split(":")
        )

        if 0 <= hour <= 29 and 0 <= minute <= 59:
            return f"{hour:02d}:{minute:02d}"

        return None

    # 1234
    if re.fullmatch(
        r"\d{3,4}",
        value
    ):
        hour = int(value[:-2])
        minute = int(value[-2:])

        if 0 <= hour <= 29 and 0 <= minute <= 59:
            return f"{hour:02d}:{minute:02d}"

    return None


def detect_type(value):
    value = clean(value)

    if (
        "ミュースカイ" in value
        or value == "μS"
        or value.lower() == "μsky"
    ):
        return "ミュースカイ"

    if (
        "快速特急" in value
        or value == "快特"
    ):
        return "快速特急"

    if value == "特急":
        return "特急"

    if (
        "快速急行" in value
        or value == "快急"
    ):
        return "快速急行"

    if value == "急行":
        return "急行"

    if value == "準急":
        return "準急"

    if value == "普通":
        return "普通"

    return ""


def detect_route(text):
    """
    PDF内の路線名を取得
    """

    routes = [
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
        "築港線"
    ]

    found = []

    for route in routes:
        if route in text:
            found.append(route)

    return "・".join(dict.fromkeys(found))


def make_id(
    train_number,
    route,
    pdf_name,
    page
):
    raw = (
        f"{train_number}|"
        f"{route}|"
        f"{pdf_name}|"
        f"{page}"
    )

    return hashlib.sha1(
        raw.encode("utf-8")
    ).hexdigest()


def parse_pdf(
    pdf_url
):
    """
    公式PDFを解析
    """

    print(
        "PDF取得:",
        pdf_url
    )

    response = session.get(
        pdf_url,
        timeout=90
    )

    response.raise_for_status()

    pdf_bytes = response.content

    filename = os.path.basename(
        pdf_url.split("?")[0]
    )

    if not filename.endswith(".pdf"):
        filename = (
            hashlib.md5(
                pdf_url.encode()
            ).hexdigest()
            + ".pdf"
        )

    local_path = os.path.join(
        PDF_DIR,
        filename
    )

    with open(
        local_path,
        "wb"
    ) as f:
        f.write(pdf_bytes)

    result = []

    with pdfplumber.open(
        io.BytesIO(pdf_bytes)
    ) as pdf:

        for page_number, page in enumerate(
            pdf.pages,
            start=1
        ):

            page_text = (
                page.extract_text()
                or ""
            )

            route = detect_route(
                page_text
            )

            tables = (
                page.extract_tables()
                or []
            )

            for table in tables:

                rows = []

                for row in table:

                    if not row:
                        continue

                    rows.append([
                        clean(cell)
                        for cell in row
                    ])

                if not rows:
                    continue

                # 列車番号を含む行を探す
                header_index = None

                for index, row in enumerate(rows):

                    joined = "".join(row)

                    if (
                        "列車番号" in joined
                        or "列車番号" in row
                    ):
                        header_index = index
                        break

                if header_index is None:
                    continue

                header = rows[
                    header_index
                ]

                train_columns = {}

                for column, value in enumerate(
                    header
                ):

                    if is_train_number(value):

                        train_columns[
                            column
                        ] = value

                if not train_columns:
                    continue

                # 種別行
                type_row = []

                if (
                    header_index + 1
                    < len(rows)
                ):
                    type_row = rows[
                        header_index + 1
                    ]

                # 行先行
                destination_row = []

                if (
                    header_index + 2
                    < len(rows)
                ):
                    destination_row = rows[
                        header_index + 2
                    ]

                for column, train_number in (
                    train_columns.items()
                ):

                    train_type = ""

                    if (
                        column
                        < len(type_row)
                    ):
                        train_type = detect_type(
                            type_row[column]
                        )

                    destination = ""

                    if (
                        column
                        < len(destination_row)
                    ):
                        destination = clean(
                            destination_row[column]
                        )

                    stops = []

                    # 駅名 + 時刻を取得
                    for row in rows[
                        header_index + 3:
                    ]:

                        if not row:
                            continue

                        if column >= len(row):
                            continue

                        station = clean(
                            row[0]
                        )

                        if not station:
                            continue

                        # ヘッダーなどを除外
                        if station in [
                            "列車番号",
                            "種別",
                            "行先",
                            "記事",
                            "備考"
                        ]:
                            continue

                        time = normalize_time(
                            row[column]
                        )

                        if time:
                            stops.append({
                                "station": station,
                                "time": time
                            })

                    if not stops:
                        continue

                    origin = (
                        stops[0]["station"]
                    )

                    if destination:
                        final_destination = destination
                    else:
                        final_destination = (
                            stops[-1]["station"]
                        )

                    train = {
                        "id": make_id(
                            train_number,
                            route,
                            filename,
                            page_number
                        ),

                        "trainNumber":
                            train_number,

                        "type":
                            train_type
                            or "普通",

                        "origin":
                            origin,

                        "destination":
                            final_destination,

                        "route":
                            route,

                        "pdf":
                            filename,

                        "page":
                            page_number,

                        "stops":
                            stops
                    }

                    result.append(
                        train
                    )

    return result


def main():

    print(
        "名鉄公式時刻表を取得します"
    )

    response = session.get(
        INDEX_URL,
        timeout=60
    )

    response.raise_for_status()

    soup = BeautifulSoup(
        response.text,
        "html.parser"
    )

    pdf_urls = []

    for link in soup.find_all(
        "a",
        href=True
    ):

        url = urljoin(
            INDEX_URL,
            link["href"]
        )

        if ".pdf" not in url.lower():
            continue

        pdf_urls.append(url)

    pdf_urls = sorted(
        set(pdf_urls)
    )

    print(
        "PDF数:",
        len(pdf_urls)
    )

    all_trains = []

    for index, url in enumerate(
        pdf_urls,
        start=1
    ):

        print(
            f"[{index}/{len(pdf_urls)}]"
        )

        try:

            trains = parse_pdf(
                url
            )

            print(
                "  列車:",
                len(trains)
            )

            all_trains.extend(
                trains
            )

        except Exception as error:

            print(
                "  解析失敗:",
                error
            )

    # 完全重複を除去
    unique = {}

    for train in all_trains:

        key = (
            train["trainNumber"],
            train["route"],
            train["pdf"],
            train["page"]
        )

        unique[key] = train

    trains = list(
        unique.values()
    )

    trains.sort(
        key=lambda x: (
            x["trainNumber"],
            x["route"]
        )
    )

    output = {
        "version": 2,

        "updatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "source":
            "名古屋鉄道公式 路線別時刻表",

        "sourceUrl":
            INDEX_URL,

        "trainCount":
            len(trains),

        "trains":
            trains
    }

    with open(
        OUTPUT,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            output,
            f,
            ensure_ascii=False,
            separators=(
                ",",
                ":"
            )
        )

    print()
    print(
        "=============================="
    )
    print(
        "JSON生成完了"
    )
    print(
        "列車データ:",
        len(trains)
    )
    print(
        "出力:",
        OUTPUT
    )
    print(
        "=============================="
    )


if __name__ == "__main__":
    main()

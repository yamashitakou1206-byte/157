def merge_segments(trains):
    """
    同一列車のPDF跨ぎを安全に結合する。

    条件:
    ・同じdayType
    ・同じ列車番号
    ・終着駅と始発駅が一致
    ・接続時刻差30分以内
    ・同一セグメントではない
    ・結合後の時刻順が正常

    曖昧な候補が複数ある場合は結合しない。
    """

    by_number = {}

    for t in trains:

        key = (
            t.get("dayType", "unknown"),
            t["trainNumber"]
        )

        by_number.setdefault(
            key, []
        ).append(t)

    output = []

    for key, segments in by_number.items():

        segments = list(segments)

        changed = True

        while changed:

            changed = False

            candidates = []

            for i, a in enumerate(segments):

                if not a.get("stops"):
                    continue

                a_end = a["stops"][-1]

                for j, b in enumerate(segments):

                    if i == j:
                        continue

                    if not b.get("stops"):
                        continue

                    b_start = b["stops"][0]

                    # 接続駅が一致しなければ不可
                    if (
                        a_end["station"]
                        !=
                        b_start["station"]
                    ):
                        continue

                    ta = time_minutes(
                        a_end["time"]
                    )

                    tb = time_minutes(
                        b_start["time"]
                    )

                    gap = tb - ta

                    if gap < 0:
                        gap += 1440

                    # 2時間は広すぎるので
                    # 30分までに制限
                    if gap > 30:
                        continue

                    candidates.append(
                        (gap, i, j)
                    )

            if not candidates:
                break

            candidates.sort(
                key=lambda x: x[0]
            )

            best_gap = candidates[0][0]

            best = [
                x
                for x in candidates
                if x[0] == best_gap
            ]

            # 同じ条件の候補が複数ある場合、
            # 誤結合防止のため結合しない
            if len(best) != 1:
                break

            _, i, j = best[0]

            a = segments[i]
            b = segments[j]

            combined_stops = list(
                a["stops"]
            )

            for stop in b["stops"][1:]:

                if (
                    combined_stops
                    and
                    stop["station"]
                    ==
                    combined_stops[-1]["station"]
                    and
                    stop["time"]
                    ==
                    combined_stops[-1]["time"]
                ):
                    continue

                combined_stops.append(
                    stop
                )

            # ----------------------------------
            # 結合後の時刻順チェック
            # ----------------------------------

            previous = None
            day_offset = 0
            valid = True

            for stop in combined_stops:

                value = time_minutes(
                    stop["time"]
                )

                value += day_offset

                if (
                    previous is not None
                    and value < previous
                ):

                    difference = (
                        previous - value
                    )

                    # 深夜跨ぎのみ許可
                    if difference <= 180:

                        day_offset += 1440
                        value += 1440

                    else:

                        valid = False
                        break

                previous = value

            if not valid:
                break

            combined = dict(a)

            combined["stops"] = (
                combined_stops
            )

            combined["destination"] = (
                b.get("destination")
                or combined["destination"]
            )

            routes = []

            for route in (
                a.get("route", ""),
                b.get("route", "")
            ):

                if (
                    route
                    and route not in routes
                ):
                    routes.append(route)

            combined["route"] = "・".join(
                routes
            )

            combined["crew"] = crew_for_route(
                combined["route"]
            )

            identity = json.dumps(
                {
                    "dayType":
                        combined.get(
                            "dayType",
                            "unknown"
                        ),

                    "trainNumber":
                        combined[
                            "trainNumber"
                        ],

                    "stops":
                        combined_stops,
                },
                ensure_ascii=False,
                separators=(",", ":")
            )

            combined["id"] = hashlib.sha1(
                identity.encode("utf-8")
            ).hexdigest()

            segments = [
                segment
                for k, segment
                in enumerate(segments)
                if k not in (i, j)
            ]

            segments.append(
                combined
            )

            changed = True

        output.extend(
            segments
        )

    return output

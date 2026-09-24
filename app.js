(() => {
  "use strict";

  const DATA_URL = "data/timetables.json";
  const passStyle = document.createElement("style");
  passStyle.textContent = `
    .station-distance{font-size:.72rem;opacity:.72;margin:2px 0 4px;font-variant-numeric:tabular-nums}
    .pass-badge,.pass-label{font-size:.68em;opacity:.85;margin-left:.35em}
    .pass-time{font-variant-numeric:tabular-nums}
  `;
  document.head.appendChild(passStyle);
  const APP_DATA_COMPAT_VERSION = 13;

  const TRAIN_TYPES = [
    "ミュースカイ",
    "快速特急",
    "特急",
    "快速急行",
    "急行",
    "準急",
    "普通"
  ];

  // =========================================================
  // 種別表示名・配色
  // ※ JSON内部の種別名は変更せず、画面表示だけ変更します。
  // =========================================================
  const TRAIN_TYPE_STYLE = {
    "ミュースカイ": {
      label: "μ.Sky",
      background: "#ffffff",
      color: "#e60012",
      border: "#e60012"
    },
    "快速特急": {
      label: "快特",
      background: "#ffffff",
      color: "#e60012",
      border: "#e60012"
    },
    "特急": {
      label: "特急",
      background: "#e60012",
      color: "#ffffff",
      border: "#e60012"
    },
    "快速急行": {
      label: "快急",
      background: "#ffffff",
      color: "#00a9e0",
      border: "#00a9e0"
    },
    "急行": {
      label: "急行",
      background: "#0066b3",
      color: "#ffffff",
      border: "#0066b3"
    },
    "準急": {
      label: "準急",
      background: "#008f45",
      color: "#ffffff",
      border: "#008f45"
    },
    "普通": {
      label: "普通",
      background: "",
      color: "",
      border: ""
    },
    "": {
      label: "—",
      background: "",
      color: "",
      border: ""
    }
  };

  // 名鉄運転台表示用の駅名略称（内部データは公式駅名のまま保持）
  const STATION_DISPLAY_NAME = {
    "中部国際空港": "中空",
    "名鉄名古屋": "名古屋",
    "名鉄一宮": "一宮",
    "名鉄岐阜": "岐阜",
    "東岡崎": "東岡",
    "岡崎公園前": "岡公",
    "中京競馬場前": "中京",
    "新木曽川": "新木曽",
    "加木屋中ノ池": "中ノ池",
    "知多武豊": "武豊",
    "豊田本町": "豊本",
    "太田川": "田川",
    "りんくう常滑": "りんくう",
    "名電赤坂": "赤坂",
    "名電長沢": "長沢",
    "名電山中": "山中",
    "矢作橋": "矢作",
    "東枇杷島": "東枇杷",
    "西枇杷島": "西枇杷",
    "丸ノ内": "丸内",
    "島氏永": "島氏",
    "妙興寺": "妙興",
    "新日鉄前": "日鉄",
    "徳重・名古屋芸大": "徳重",
    "木津用水": "用水",
    "犬山遊園": "犬遊",
    "大森・金城学院前": "金城学院",
    "尾張瀬戸": "瀬戸",
    "瀬戸市役所前": "瀬戸市役所",
    "巽ヶ丘": "巽",
    "半田口": "半口",
    "住吉町": "住吉",
    "河和口": "河口",
    "三河八橋": "八橋",
    "観音寺": "観音",
    "苅安賀": "苅安",
    "上丸渕": "上渕"
  };

  function displayStationName(value) {
    const name = normalizeStationName(value);
    return STATION_DISPLAY_NAME[name] || name;
  }

  // 公式時刻表で確認した列車単位の補正値。デモ列車ではありません。
  // 299は2026年3月14日改正の土休日時刻表で「特急・名古屋行」と確認でき、
  // 編成は6両として表示します。
  const TRAIN_METADATA_OVERRIDES = {};

  let trains = [];
  let selectedTrain = null;
  let selectedScheduleIndex = null;
  let darkMode = true;
  let zoom = 1;

  // v19: 停車30秒前表示用の仮想時計
  let stopSimMode = false;
  let stopSimSeconds = null;
  let stopSimRunning = false;
  let stopSimSpeed = 1;
  let alertStopIndex = -1;
  let confirmedStopKey = "";

  // 平日／土休日の状態
  let activeDayType = (() => {
    try {
      const saved = localStorage.getItem("meitetsuDayType");
      if (saved === "weekday" || saved === "holiday") return saved;
    } catch (_) {}
    const day = new Date().getDay();
    return (day === 0 || day === 6) ? "holiday" : "weekday";
  })();

  let dayTypeAuto = (() => {
    try {
      return localStorage.getItem("meitetsuDayTypeAuto") !== "false";
    } catch (_) {
      return true;
    }
  })();

  let loadingData = false;

  const $ = id => document.getElementById(id);

  const el = {
    digital: $("digital"),
    dateText: $("dateText"),

    trainNumberInput: $("trainNumberInput"),
    trainSearchBtn: $("trainSearchBtn"),
    trainSearchResult: $("trainSearchResult"),
    dataStatus: $("dataStatus"),
    dayTypeSelect: $("dayTypeSelect"),
    dayTypeAutoBtn: $("dayTypeAutoBtn"),

    trainType: $("trainType"),
    serviceCode: $("serviceCode"),
    cars: $("cars"),
    origin: $("origin"),
    destination: $("destination"),
    trainNo: $("trainNo"),

    currentLocation: $("currentLocation"),
    nextStop: $("nextStop"),
    eta: $("eta"),
    routeMap: $("routeMap"),

    scheduleTable: $("scheduleTable")
      ? $("scheduleTable").querySelector("tbody")
      : null,

    metricStation: $("metricStation"),
    metricLine: $("metricLine"),
    metricNext: $("metricNext"),
    metricCountdown: $("metricCountdown"),
    metricPosition: $("metricPosition"),

    positionUpdated: $("positionUpdated"),
    lastUpdated: $("lastUpdated"),

    nextTrains: $("nextTrains"),

    detailView: $("detailView"),
    listView: $("listView"),
    detailCrewName: $("detailCrewName"),
    detailDate: $("detailDate"),
    detailType: $("detailType"),
    detailCode: $("detailCode"),
    detailCars: $("detailCars"),
    detailOrigin: $("detailOrigin"),
    detailDestination: $("detailDestination"),
    detailTrainNo: $("detailTrainNo"),
    detailSchedule: $("detailSchedule"),
    detailDigital: $("detailDigital"),
    detailCrewState: $("detailCrewState"),
    detailNotice: $("detailNotice"),
    detailRunningLocation: $("detailRunningLocation"),

    analog: $("analog"),
    detailAnalog: $("detailAnalog"),

    bannerTitle: $("bannerTitle"),
    bannerText: $("bannerText")
  };

  // =========================================================
  // 種別表示処理
  // =========================================================

  function getTrainTypeStyle(type) {
    return (
      TRAIN_TYPE_STYLE[type] ||
      TRAIN_TYPE_STYLE[""]
    );
  }

  function applyTrainTypeStyle(element, type) {
    if (!element) return;

    const style = getTrainTypeStyle(type);

    element.textContent = style.label;

    // 参照画面と同じ「セルいっぱいの種別表示」にします。
    // 色はTRAIN_TYPE_STYLEから直接適用し、CSS側の共通スタイルに
    // 上書きされないようimportantで設定します。
    element.style.display = "grid";
    element.style.alignItems = "center";
    element.style.justifyContent = "center";
    element.style.fontWeight = "700";
    element.style.border = "0";
    element.style.borderRadius = "0";

    // 普通は既存デザインを維持
    if (type === "普通" || !style.background) {
      element.style.setProperty("background-color", "#ffffff", "important");
      element.style.setProperty("color", "#111111", "important");
      element.style.removeProperty("border-color");
      element.style.removeProperty("box-shadow");
      element.removeAttribute("data-train-type");
      return;
    }

    element.style.setProperty("background-color", style.background, "important");
    element.style.setProperty("color", style.color, "important");
    element.style.setProperty("border-color", style.border || "transparent", "important");
    element.style.setProperty("box-shadow", "none", "important");
    element.dataset.trainType = type;

    // 次列車欄は少しコンパクトに
    if (element.classList.contains("next-train-type")) {
      element.style.padding = "3px 7px";
      element.style.fontSize = "11px";
      element.style.lineHeight = "1.2";
    }

    // 白背景の種別は輪郭を少し見やすくする
    // 乗務員画面では光彩・丸角などを付けず、写真の平面的な罫線表示にします。
  }

  // =========================================================
  // データ読み込み
  // =========================================================

  function normalizeDayType(value) {
    const v = String(value || "").toLowerCase();
    if (v === "holiday" || v === "土休日" || v === "土日祝" || v === "休日") return "holiday";
    if (v === "weekday" || v === "平日") return "weekday";
    return "unknown";
  }

  function getAutoDayType(date = new Date()) {
    const day = date.getDay();
    return (day === 0 || day === 6) ? "holiday" : "weekday";
  }

  function setActiveDayType(value, auto = false) {
    const normalized = normalizeDayType(value);
    if (normalized === "unknown") return;
    activeDayType = normalized;
    dayTypeAuto = Boolean(auto);
    if (el.dayTypeSelect) el.dayTypeSelect.value = activeDayType;
    localStorage.setItem("meitetsuDayType", activeDayType);
    localStorage.setItem("meitetsuDayTypeAuto", String(dayTypeAuto));
    updateDayTypeStatus();
    if (trains.length) {
      populateLines();
      renderNextTrains();
      if (selectedTrain && normalizeDayType(selectedTrain.dayType) !== activeDayType) {
        selectedTrain = null;
        if (!el.detailView?.hidden) closeDetail();
      }
    }
  }

  function updateDayTypeStatus() {
    if (!el.dayTypeSelect) return;
    el.dayTypeSelect.value = activeDayType;
    if (el.dayTypeAutoBtn) {
      el.dayTypeAutoBtn.textContent = dayTypeAuto ? "自動中" : "自動";
      el.dayTypeAutoBtn.classList.toggle("active", dayTypeAuto);
    }
  }

  function getDayFilteredTrains() {
    const exact = trains.filter(t => normalizeDayType(t.dayType) === activeDayType);
    // Old JSON (v8 and earlier) had no dayType. Keep it usable as weekday
    // data rather than silently hiding every record.
    if (exact.length) return exact;
    if (activeDayType === "weekday") {
      return trains.filter(t => !t.dayType || normalizeDayType(t.dayType) === "unknown");
    }
    return [];
  }

  function getDayTypeLabel(value) {
    return normalizeDayType(value) === "holiday" ? "土休日" : "平日";
  }

  async function loadData() {
    if (loadingData) return;

    loadingData = true;
    setStatus("時刻表データを読み込み中…");

    try {
      const response = await fetch(DATA_URL, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      setStatus("時刻表データを解析中…");
      const json = await response.json();

      if (Array.isArray(json)) {
        trains = json;
      } else if (Array.isArray(json.trains)) {
        trains = json.trains;
      } else {
        trains = [];
      }

      normalizeAllTrains();
      if (dayTypeAuto) activeDayType = getAutoDayType();
      updateDayTypeStatus();
      const dayTrains = getDayFilteredTrains();

      setStatus(
        `時刻表データ読込完了　全${trains.length.toLocaleString()}列車 / ${getDayTypeLabel(activeDayType)} ${dayTrains.length.toLocaleString()}列車`
      );

      selectedTrain = null;
      showSearchResult("", "列車番号を入力してください。");

    } catch (error) {
      console.error(error);

      setStatus("時刻表データを読み込めませんでした。");
      trains = [];
      selectedTrain = null;
      showSearchResult("", "時刻表データを読み込めませんでした。");
    } finally {
      loadingData = false;
    }

    populateLines();
    renderNextTrains();
  }

  function normalizeAllTrains() {
    trains = trains.map(train => {
      const stops = normalizeStops(train);

      const trainNumber = String(
        train.trainNumber ??
        train.number ??
        ""
      ).trim();
      const override = TRAIN_METADATA_OVERRIDES[trainNumber] || {};

      return {
        ...train,

        trainNumber,

        dayType: normalizeDayType(train.dayType || train.serviceDay || train.calendar),

        type: override.type || train.type || "",

        origin:
          normalizeStationName(train.origin) ||
          (stops[0] ? stops[0].station : ""),

        destination:
          normalizeStationName(override.destination) ||
          normalizeStationName(train.destination) ||
          (stops.length
            ? stops[stops.length - 1].station
            : ""),

        route: train.route || "",

        crew:
          train.crew ||
          crewForRoute(train.route || ""),

        // 両数はPDF/解析データを使用せず、運転画面で手入力します。
        cars: null,

        stops
      };
    });
  }

  // PDF抽出時に発生する重複文字・ページ境界文字を画面側でも救済します。
  // 例: 774466 -> 746 / 豊豊橋橋 -> 豊橋
  function collapseDuplicateGlyphs(value) {
    let s = String(value ?? "").trim();
    for (let i = 0; i < 5; i++) {
      const next = s.replace(/(.)\1/g, "$1");
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function normalizeStationName(value) {
    const s = collapseDuplicateGlyphs(value)
      .replace(/[\\u3000 ]+/g, "")
      .trim();

    if (!s) return "";
    if (s.includes("前のページ") || s.includes("次のページ")) return "";
    if (s.includes("ページ") && /\\d/.test(s)) return "";

    const bad = new Set([
      "始", "終", "発", "着", "始発", "終着",
      "記事", "行先", "列車番号", "種別",
      "平日", "土休日", "土日祝"
    ]);
    if (bad.has(s)) return "";
    if (/^[0-9A-Za-z.]+$/.test(s)) return "";
    if (s.length > 20) return "";
    return s;
  }

  function normalizeStops(train) {
    if (Array.isArray(train.stops)) {
      const result = [];

      for (const x of train.stops) {
        const station = normalizeStationName(x.station ?? x.name ?? "");
        const rawTime = x.time ?? x.arrival ?? x.departure ?? "";
        const time = normalizeTime(rawTime);

        if (!station || !time) continue;

        const stop = {
          ...x,
          station,
          time,
          arrival: normalizeTime(x.arrival ?? x.arrivalTime ?? x.着時刻 ?? ""),
          departure: normalizeTime(x.departure ?? x.departureTime ?? x.departTime ?? x.発時刻 ?? "")
        };
        // 単一時刻しかない従来JSONは従来どおり time を主時刻として保持します。
        if (!stop.arrival) stop.arrival = time;
        if (!stop.departure) stop.departure = time;

        // PDF解析側が秒を別フィールドで持っている場合も保持します。
        if (x.seconds != null && x.seconds !== "") stop.seconds = Number(x.seconds);
        else if (x.sec != null && x.sec !== "") stop.seconds = Number(x.sec);
        else if (x.second != null && x.second !== "") stop.seconds = Number(x.second);

        const prev = result[result.length - 1];
        if (prev && prev.station === station && prev.time === time &&
            String(prev.seconds ?? "") === String(stop.seconds ?? "")) continue;

        result.push(stop);
      }

      return repairKnownAndValidateStops(train, result);
    }

    if (Array.isArray(train.stations) && Array.isArray(train.times)) {
      const result = [];

      train.stations.forEach((station, i) => {
        const name = normalizeStationName(station);
        const time = normalizeTime(train.times[i]);

        if (!name || !time) return;

        const stop = {
          station: name,
          time,
          arrival: time,
          departure: time
        };

        const seconds = train.seconds?.[i] ?? train.secs?.[i] ?? train.second?.[i];
        if (seconds != null && seconds !== "") stop.seconds = Number(seconds);

        const prev = result[result.length - 1];
        if (prev && prev.station === name && prev.time === time &&
            String(prev.seconds ?? "") === String(stop.seconds ?? "")) return;

        result.push(stop);
      });

      return repairKnownAndValidateStops(train, result);
    }

    return [];
  }

  // PDFのページ境界をまたいだ列車で、別列車の停車駅・時刻が混入する問題を防止します。
  // まず実際の公式時刻表で確認できた299/300を正しい停車駅・時刻に固定し、
  // それ以外も時刻が大きく逆戻りする混入データを画面に出さないようにします。
  function repairKnownAndValidateStops(train, stops) {
    const no = String(train.trainNumber ?? train.number ?? train.trainNo ?? '').replace(/\D/g, '');

    const fixed = {};

    const out = [];
    let prevSeconds = null;
    for (const stop of stops) {
      const t = timeToSeconds(stop.time);
      if (Number.isFinite(t) && Number.isFinite(prevSeconds)) {
        // 同一列車内で30分以上の逆戻りは、PDF別列車の混入とみなします。
        // 深夜跨ぎ（23時→00時台）は例外として許可します。
        const delta = t - prevSeconds;
        const overnight = prevSeconds >= 23*3600 && t <= 2*3600;
        if (delta < -1800 && !overnight) break;
      }
      out.push(stop);
      if (Number.isFinite(t)) prevSeconds = t;
    }
    return out;
  }

  function timeToSeconds(value) {
    const m = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return NaN;
    return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3] || 0);
  }

  function normalizeTime(value) {
    if (!value) return "";

    const s = collapseDuplicateGlyphs(String(value).trim());

    // HH:MM:SS を保持。公式PDFの秒情報を画面で表示できるようにします。
    const hms = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hms) {
      const h = String(Number(hms[1])).padStart(2, "0");
      const m = hms[2];
      const sec = hms[3];
      return sec != null ? `${h}:${m}:${sec}` : `${h}:${m}`;
    }

    if (/^\d{5,6}$/.test(s)) {
      const digits = s;
      const h = String(Number(digits.slice(0, -4))).padStart(2, "0");
      const m = digits.slice(-4, -2);
      const sec = digits.slice(-2);
      return `${h}:${m}:${sec}`;
    }

    if (/^\d{3,4}$/.test(s)) {
      if (s.length === 3) {
        return `0${Number(s[0])}:${s.slice(1)}`;
      }
      return `${String(Number(s.slice(0, 2))).padStart(2, "0")}:${s.slice(2)}`;
    }

    return "";
  }

  // 運転台表示用：時・分は常に2桁、秒がある場合は小さく表示します。
  function railTimeParts(value, extraSeconds = null) {
    let raw = String(value ?? "").trim();
    // 公式PDF由来の表記だけでなく、運転台用データの
    // "7:03 00" / "7:03:00" / "70300" も受け取れるようにします。
    raw = raw.replace(/[　\t]+/g, " ");

    let m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:秒)?$/);
    if (m) {
      const sec = m[3] != null ? m[3] : (extraSeconds != null && extraSeconds !== "" ? String(Number(extraSeconds)).padStart(2, "0") : "");
      return { main: `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`, seconds: sec };
    }

    // "7:03 00" のように秒だけ空白区切りになっている場合
    m = raw.match(/^(\d{1,2}):(\d{2})\s+(\d{1,2})$/);
    if (m) {
      return { main: `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`, seconds: String(Number(m[3])).padStart(2, "0") };
    }

    // 703 / 0703 のような既存JSONにも対応
    m = raw.match(/^(\d{3,4})(?:\s+(\d{1,2}))?$/);
    if (m) {
      const digits = m[1].padStart(4, "0");
      const sec = m[2] != null ? String(Number(m[2])).padStart(2, "0") : (extraSeconds != null && extraSeconds !== "" ? String(Number(extraSeconds)).padStart(2, "0") : "");
      return { main: `${digits.slice(0,2)}:${digits.slice(2)}`, seconds: sec };
    }

    return {
      main: raw || "—",
      seconds: extraSeconds != null && extraSeconds !== "" ? String(Number(extraSeconds)).padStart(2, "0") : ""
    };
  }

  function railTimeHtml(value, extraSeconds = null) {
    const p = railTimeParts(value, extraSeconds);
    if (!p.seconds) return escapeHtml(p.main);
    const sec = String(p.seconds).padStart(2, "0").slice(-2);
    const cls = sec === "00" ? "time-sec time-sec-zero" : "time-sec";
    return `<span class="time-main">${escapeHtml(p.main)}</span><span class="${cls}" data-seconds="${escapeHtml(sec)}">${escapeHtml(sec)}</span>`;
  }

  // =========================================================
  // 乗務区
  // =========================================================

  function crewForRoute(route) {
    if (!route) return "名古屋乗務区";

    if (
      /名古屋本線|豊川線|津島線|尾西線|竹鼻線|羽島線/.test(route)
    ) {
      return "名古屋乗務区";
    }

    if (
      /常滑線|空港線|河和線|知多新線/.test(route)
    ) {
      return "神宮前乗務区";
    }

    if (
      /犬山線|各務原線|広見線|小牧線/.test(route)
    ) {
      return "犬山乗務区";
    }

    if (
      /三河線|豊田線|西尾線|蒲郡線/.test(route)
    ) {
      return "知立乗務区";
    }

    if (/瀬戸線/.test(route)) {
      return "瀬戸運輸区";
    }

    return "名古屋乗務区";
  }

  // =========================================================
  // 列車検索
  // =========================================================

  function findTrain(number) {
    const target = String(number).trim().toUpperCase();
    if (!target) return null;
    const candidates = trains.filter(train =>
      String(train.trainNumber).trim().toUpperCase() === target &&
      normalizeDayType(train.dayType) === activeDayType
    );
    if (candidates.length) return chooseTrainCandidate(candidates);
    // Backward compatibility for old JSON with no dayType.
    if (activeDayType === "weekday") {
      const legacy = trains.filter(train =>
        String(train.trainNumber).trim().toUpperCase() === target &&
        normalizeDayType(train.dayType) === "unknown"
      );
      if (legacy.length) return chooseTrainCandidate(legacy);
    }
    return null;
  }

  function chooseTrainCandidate(candidates) {
    // 同一列車番号が複数PDF/区間に残った場合は、現在時刻への近さより
    // 「時刻表としてどれだけ完全か」を優先する。短い断片を選ばない。
    const quality = train => {
      const stops = Array.isArray(train.stops) ? train.stops : [];
      const timed = stops.filter(s => normalizeTime(s?.time || s?.arrival || s?.departure)).length;
      const saneStations = stops.filter(s => {
        const n = normalizeStationName(s?.station || s?.name || "");
        return n && n.length >= 2 && n.length <= 20;
      }).length;
      const hasOrigin = normalizeStationName(train.origin || "") ? 1 : 0;
      const hasDestination = normalizeStationName(train.destination || "") ? 1 : 0;
      return timed * 100 + saneStations * 20 + stops.length * 5 + hasOrigin * 3 + hasDestination * 3;
    };
    return [...candidates].sort((a, b) => quality(b) - quality(a))[0] || candidates[0];
  }

  function searchTrain() {
    const number =
      el.trainNumberInput?.value.trim();

    if (!number) {
      showSearchResult(
        "",
        "列車番号を入力してください。"
      );
      return;
    }

    const train = findTrain(number);

    if (train) {
      selectTrain(train, true);

      showSearchResult(
        train.trainNumber,
        "列車情報を読み込みました。"
      );

      return;
    }

    const otherDay = trains.some(t => String(t.trainNumber).trim().toUpperCase() === number.toUpperCase());
    showSearchResult(
      number,
      otherDay
        ? `${getDayTypeLabel(activeDayType)}の時刻表にはこの列車番号がありません。上の区分を切り替えてください。`
        : "この列車番号は現在のデータにありません。"
    );
  }

  // =========================================================
  // 列車選択
  // =========================================================

  function selectTrain(train, detail) {
    selectedScheduleIndex = null;
    alertStopIndex = -1;
    selectedTrain = {
      ...train,
      dayType: normalizeDayType(train.dayType),
      crew:
        train.crew ||
        crewForRoute(train.route),
      // 列車を選ぶたびに両数は手入力。PDF側のcars値は採用しません。
      cars: null
    };

    renderTrain();
    renderRoute();
    renderSchedule();
    renderMetrics();
    renderNextTrains();

    if (detail) {
      openDetail();
    }
  }

  // =========================================================
  // 列車情報表示
  // =========================================================

  function renderTrain() {
    if (!selectedTrain) return;

    const t = selectedTrain;

    // ★ 種別表示名＋指定カラー
    applyTrainTypeStyle(
      el.trainType,
      t.type || ""
    );

    if (el.serviceCode) {
      el.serviceCode.textContent =
        serviceCode(t.type);
    }

    if (el.cars) {
      el.cars.textContent =
        Number.isFinite(Number(t.cars)) && Number(t.cars) > 0 ? `${Number(t.cars)}両` : "—";
    }

    if (el.origin) {
      el.origin.textContent =
        displayStationName(t.origin) || "—";
    }

    if (el.destination) {
      el.destination.textContent =
        displayStationName(t.destination) || "—";
    }

    if (el.trainNo) {
      el.trainNo.textContent =
        t.trainNumber || "—";
    }
  }

  function serviceCode(type) {
    const map = {
      "ミュースカイ": "μ",
      "快速特急": "快特",
      "特急": "特",
      "快速急行": "快急",
      "急行": "急",
      "準急": "準",
      "普通": "普"
    };

    return map[type] || "M";
  }


  // =========================================================
  // 現在位置計算
  // =========================================================

  function stopEventTime(stop) {
    if (!stop) return "";
    return stop.kind === "pass" && stop.passTime
      ? String(stop.passTime)
      : String(stop.time || "");
  }

  function timeToSeconds(time) {
    const parts = String(time || "").split(":").map(Number);
    if (parts.length < 2 || parts.some(Number.isNaN)) return NaN;
    const h = parts[0];
    const m = parts[1];
    const sec = parts.length >= 3 ? parts[2] : 0;
    return h * 3600 + m * 60 + sec;
  }

  function displayStopTime(stop) {
    if (!stop) return "—";
    if (stop.kind === "pass" && stop.passTime) return `${stop.passTime} 推定`;
    return stop.time || "—";
  }

  function distanceBetweenStops(a, b) {
    if (!a || !b) return null;
    // Builder embeds the distance on each stop when available.
    const d = Number(b.distanceFromPreviousKm);
    return Number.isFinite(d) ? d : null;
  }

  function getSimulation(now = new Date()) {
    if (!selectedTrain || !selectedTrain.stops.length) {
      return { index: -1, nextIndex: -1, progress: 0, state: "待機" };
    }

    const stops = selectedTrain.stops;
    const currentSeconds =
      now.getHours() * 3600 +
      now.getMinutes() * 60 +
      now.getSeconds();

    const times = stops.map(s => timeToSeconds(stopEventTime(s)));

    if (Number.isNaN(times[0]) || currentSeconds < times[0]) {
      return { index: -1, nextIndex: 0, progress: 0, state: "発車待ち" };
    }

    let lastValid = times.length - 1;
    while (lastValid >= 0 && Number.isNaN(times[lastValid])) lastValid--;
    if (lastValid < 0) return { index: -1, nextIndex: -1, progress: 0, state: "待機" };

    if (currentSeconds >= times[lastValid]) {
      return {
        index: lastValid,
        nextIndex: -1,
        progress: 1,
        state: stops[lastValid].kind === "pass" ? "通過" : "終着"
      };
    }

    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i];
      const b = times[i + 1];
      if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue;

      if (currentSeconds >= a && currentSeconds < b) {
        const progress =
          (currentSeconds - a) / Math.max(1, b - a);
        const nearEvent = Math.abs(currentSeconds - a) <= 2;
        let state = "走行中";
        if (nearEvent) {
          state = stops[i].kind === "pass" ? "通過" : "停車";
        }
        return { index: i, nextIndex: i + 1, progress, state };
      }
    }

    return { index: 0, nextIndex: 1, progress: 0, state: "走行中" };
  }

  function timeToMinutes(time) {
    const sec = timeToSeconds(time);
    return Number.isFinite(sec) ? sec / 60 : NaN;
  }

  // =========================================================
  // 路線図
  // =========================================================

  function renderRoute() {
    if (!el.routeMap || !selectedTrain) return;

    const stops = selectedTrain.stops;

    el.routeMap.innerHTML = "";

    if (!stops.length) {
      el.routeMap.innerHTML =
        `<div class="empty-route">停車駅データがありません</div>`;
      return;
    }

    const simulation = getSimulation();

    const line =
      document.createElement("div");

    line.className =
      "sim-route-line";

    stops.forEach((stop, i) => {
      const node =
        document.createElement("div");

      node.className =
        "sim-station";

      if (i < simulation.index) {
        node.classList.add("passed");
      }

      if (i === simulation.index) {
        node.classList.add("current");
      }

      if (i === simulation.nextIndex) {
        node.classList.add("next");
      }

      const distance = i > 0
        ? distanceBetweenStops(stops[i - 1], stop)
        : null;
      const cumulative = Number(stop.distanceKm);
      const distanceHtml = distance != null
        ? `<div class="station-distance">区間 ${distance.toFixed(1)} km${Number.isFinite(cumulative) ? ` / 累計 ${cumulative.toFixed(1)} km` : ""}</div>`
        : (Number.isFinite(cumulative) ? `<div class="station-distance">累計 ${cumulative.toFixed(1)} km</div>` : "");

      node.innerHTML = `
        ${distanceHtml}
        <div class="station-dot"></div>
        <div class="station-name">
          ${escapeHtml(displayStationName(stop.station))}
          ${stop.kind === "pass" ? '<span class="pass-badge">通過</span>' : ''}
        </div>
        <div class="station-time ${stop.kind === "pass" ? 'pass-time' : ''}">
          ${escapeHtml(displayStopTime(stop))}
        </div>
      `;

      line.appendChild(node);
    });

    el.routeMap.appendChild(line);

    const trainMarker =
      document.createElement("div");

    trainMarker.className =
      "sim-train-marker";

    let position = 0;

    if (simulation.index >= 0) {
      position =
        (
          simulation.index +
          simulation.progress
        ) /
        Math.max(1, stops.length - 1);
    }

    position =
      Math.max(0, Math.min(1, position));

    trainMarker.style.left =
      `calc(${position * 100}% - 14px)`;

    trainMarker.innerHTML = "🚆";

    line.appendChild(trainMarker);
  }

  // =========================================================
  // 時刻表
  // =========================================================

  function renderSchedule() {
    if (
      !el.scheduleTable ||
      !selectedTrain
    ) {
      return;
    }

    const simulation =
      getSimulation();

    el.scheduleTable.innerHTML = "";

    selectedTrain.stops.forEach(
      (stop, i) => {
        const tr =
          document.createElement("tr");

        let status = "";

        if (i < simulation.index) {
          status = stop.kind === "pass" ? "通過済" : "通過済";
        } else if (i === simulation.index) {
          status = simulation.state === "通過"
            ? "通過"
            : (simulation.state === "停車" ? "停車中" : "現在位置");
        } else if (i === simulation.nextIndex) {
          status = stop.kind === "pass" ? "通過予定" : "次駅";
        } else {
          status = stop.kind === "pass" ? "通過予定" : "これから";
        }

        const shownTime = displayStopTime(stop);
        const distance = i > 0 ? distanceBetweenStops(selectedTrain.stops[i - 1], stop) : null;
        const cumulative = Number(stop.distanceKm);
        const distanceText = Number.isFinite(cumulative)
          ? `${distance != null ? `${distance.toFixed(1)} km / ` : ""}累計 ${cumulative.toFixed(1)} km / `
          : (distance != null ? `${distance.toFixed(1)} km / ` : "");
        tr.innerHTML = `
          <td>${escapeHtml(displayStationName(stop.station))}${stop.kind === "pass" ? ' <small class="pass-label">通過</small>' : ''}</td>
          <td>${railTimeHtml(stop.time, stop.seconds)}</td>
          <td>${stop.kind === "pass" ? railTimeHtml(stopEventTime(stop), stop.seconds) : railTimeHtml(stop.time, stop.seconds)}</td>
          <td>${distanceText}${escapeHtml(status)}</td>
          <td>${i === simulation.index ? "●" : ""}</td>
        `;

        tr.classList.add("schedule-selectable");
        tr.dataset.stopIndex = String(i);
        tr.setAttribute("role", "button");
        tr.setAttribute("tabindex", "0");
        if (i === simulation.index) tr.classList.add("current-row");
        if (i === selectedScheduleIndex) tr.classList.add("selected-row");
        const selectMainRow = () => {
          selectedScheduleIndex = selectedScheduleIndex === i ? null : i;
          renderSchedule();
          renderDetail();
        };
        tr.addEventListener("click", selectMainRow);
        tr.addEventListener("pointerup", (ev) => {
          if (ev.pointerType === "touch") { ev.preventDefault(); selectMainRow(); }
        });
        tr.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectMainRow(); }
        });

        el.scheduleTable.appendChild(tr);
      }
    );
  }

  // =========================================================
  // メトリクス
  // =========================================================

  function renderMetrics() {
    if (!selectedTrain) return;

    const simulation =
      getSimulation();

    const stops =
      selectedTrain.stops;

    const current =
      simulation.index >= 0
        ? stops[simulation.index]
        : null;

    const next =
      simulation.nextIndex >= 0
        ? stops[simulation.nextIndex]
        : null;

    if (el.metricStation) {
      el.metricStation.textContent =
        current
          ? current.station
          : "発車待ち";
    }

    if (el.metricLine) {
      const totalDistance = Number(selectedTrain.distanceKm);
      el.metricLine.textContent =
        selectedTrain.route ||
        "路線情報";
      if (Number.isFinite(totalDistance)) {
        el.metricLine.textContent += ` ・ 走行距離 ${totalDistance.toFixed(1)} km`;
      }
    }

    if (el.metricNext) {
      el.metricNext.textContent =
        next
          ? displayStopTime(next)
          : "--:--";
    }

    if (el.metricPosition) {
      el.metricPosition.textContent =
        current
          ? current.station
          : "—";
    }

    if (el.currentLocation) {
      el.currentLocation.textContent =
        current
          ? `現在位置：${displayStationName(current.station)}`
          : "現在位置：始発待ち";
    }

    if (el.nextStop) {
      el.nextStop.textContent =
        next
          ? `次駅：${displayStationName(next.station)}`
          : "次駅：—";
    }

    updateCountdown();
  }

  function updateCountdown() {
    if (!selectedTrain) return;

    const simulation =
      getSimulation();

    const nextIndex =
      simulation.nextIndex;

    if (
      nextIndex < 0 ||
      !selectedTrain.stops[nextIndex]
    ) {
      if (el.eta) {
        el.eta.textContent =
          "到着：終着";
      }

      if (el.metricCountdown) {
        el.metricCountdown.textContent =
          "終着";
      }

      return;
    }

    const now = new Date();

    const current =
      now.getHours() * 60 +
      now.getMinutes() +
      now.getSeconds() / 60;

    const target =
      timeToMinutes(
        stopEventTime(selectedTrain.stops[nextIndex])
      );

    const diff =
      Math.max(0, target - current);

    const totalSeconds =
      Math.round(diff * 60);

    const min =
      Math.floor(totalSeconds / 60);

    const sec =
      totalSeconds % 60;

    const text =
      `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;

    if (el.eta) {
      el.eta.textContent =
        `到着まで ${text}`;
    }

    if (el.metricCountdown) {
      el.metricCountdown.textContent =
        `到着まで ${text}`;
    }
  }

  // =========================================================
  // 走行地点（時刻表から推定）
  // =========================================================
  function ensureRunningLocationPanel() {
    if (document.getElementById("detailRunningLocation")) {
      el.detailRunningLocation = document.getElementById("detailRunningLocation");
      return el.detailRunningLocation;
    }
    if (!el.detailNotice) return null;
    const panel = document.createElement("div");
    panel.id = "detailRunningLocationPanel";
    panel.innerHTML = `<div class="detail-running-title">走行地点</div><div id="detailRunningLocation" class="detail-running-value">—</div>`;
    panel.style.cssText = "border-top:1px solid #777;border-bottom:1px solid #777;background:#fff;color:#111;";
    const title = panel.querySelector(".detail-running-title");
    const value = panel.querySelector(".detail-running-value");
    if (title) title.style.cssText = "background:#999;padding:3px 8px;font-size:18px;line-height:1.25;";
    if (value) value.style.cssText = "padding:7px 8px;font-size:20px;font-weight:600;line-height:1.25;min-height:25px;";
    const noticeParent = el.detailNotice.parentElement;
    if (noticeParent) noticeParent.insertBefore(panel, el.detailNotice);
    el.detailRunningLocation = value;
    return value;
  }

  function normalizedEventSeconds(value, reference) {
    let sec = timeToSeconds(value);
    if (!Number.isFinite(sec)) return NaN;
    if (Number.isFinite(reference)) {
      while (sec < reference - 43200) sec += 86400;
      while (sec > reference + 43200) sec -= 86400;
    }
    return sec;
  }

  function getRunningLocation(nowSeconds = driverNowSeconds()) {
    const stops = selectedTrain?.stops || [];
    if (!stops.length) return { text: "—", state: "待機" };

    let cursor = null;
    const events = stops.map((stop, index) => {
      let arr = normalizedEventSeconds(stop.arrival || stop.time || stop.passTime, cursor);
      let dep = normalizedEventSeconds(stop.departure || stop.time || stop.passTime, Number.isFinite(arr) ? arr : cursor);
      if (!Number.isFinite(arr) && Number.isFinite(dep)) arr = dep;
      if (!Number.isFinite(dep) && Number.isFinite(arr)) dep = arr;
      if (Number.isFinite(dep) && Number.isFinite(arr) && dep < arr) dep += 86400;
      if (Number.isFinite(dep)) cursor = dep;
      else if (Number.isFinite(arr)) cursor = arr;
      return { stop, index, arr, dep };
    }).filter(e => Number.isFinite(e.arr) || Number.isFinite(e.dep));
    if (!events.length) return { text: "—", state: "待機" };

    let now = nowSeconds;
    const first = Number.isFinite(events[0].arr) ? events[0].arr : events[0].dep;
    const lastEvent = events[events.length - 1];
    const last = Number.isFinite(lastEvent.dep) ? lastEvent.dep : lastEvent.arr;
    if (last >= 86400 && now < 43200) now += 86400;

    if (now < first) return { text: `${displayStationName(events[0].stop.station)} 発車前`, state: "発車待ち" };

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const arr = Number.isFinite(e.arr) ? e.arr : e.dep;
      const dep = Number.isFinite(e.dep) ? e.dep : arr;
      if (now >= arr && now <= dep && e.stop.kind !== "pass") {
        return { text: `${displayStationName(e.stop.station)}駅 停車中`, state: "停車" };
      }
      const n = events[i + 1];
      if (!n) continue;
      const nextArr = Number.isFinite(n.arr) ? n.arr : n.dep;
      if (now > dep && now < nextArr) {
        const span = Math.max(1, nextArr - dep);
        const progress = Math.max(0, Math.min(1, (now - dep) / span));
        const a = displayStationName(e.stop.station);
        const b = displayStationName(n.stop.station);
        let text = `${a}駅 ～ ${b}駅間`;
        const d0 = Number(e.stop.distanceKm);
        const d1 = Number(n.stop.distanceKm);
        if (Number.isFinite(d0) && Number.isFinite(d1) && d1 >= d0) {
          const km = d0 + (d1 - d0) * progress;
          text += `（推定 ${km.toFixed(3)} km）`;
        }
        return { text, state: "走行中", progress, from: e.index, to: n.index };
      }
    }
    return { text: `${displayStationName(lastEvent.stop.station)}駅 終着`, state: "終着" };
  }

  function updateRunningLocation() {
    const node = ensureRunningLocationPanel();
    if (!node) return;
    node.textContent = selectedTrain ? getRunningLocation().text : "—";
  }

  // =========================================================
  // 詳細画面
  // =========================================================

  function enterDriverFullscreen() {
    // PWA (iOS/Android installed mode) is already browser-chrome-free.
    // On browsers with the Fullscreen API, a user action such as train-number
    // search can enter fullscreen because it still carries user activation.
    if (window.matchMedia?.("(display-mode: standalone)").matches) return;
    if (document.fullscreenElement) return;
    const target = document.documentElement;
    if (!target.requestFullscreen) return;
    Promise.resolve(target.requestFullscreen({ navigationUI: "hide" })).catch(() => {});
  }

  // 運転表示画面では「通常画面の黒いヘッダー」と「下部ナビ」だけを隠す。
  // 白い乗務区タイトル(detail-top)は残す。iPadのPWAでも確実に反映されるよう、
  // CSS class に加えて要素へ直接 display:none を設定する。
  function setDriverChromeHidden(hidden) {
    document.body.classList.toggle("driver-mode", hidden);

    const chrome = [
      document.querySelector("body > .topbar"),
      document.querySelector("body > .bottom-nav"),
      document.querySelector("body > footer")
    ].filter(Boolean);

    chrome.forEach((node) => {
      if (hidden) {
        if (!node.dataset.driverDisplay) {
          node.dataset.driverDisplay = node.style.display || "";
        }
        node.style.setProperty("display", "none", "important");
      } else {
        const previous = node.dataset.driverDisplay ?? "";
        node.style.removeProperty("display");
        if (previous) node.style.display = previous;
        delete node.dataset.driverDisplay;
      }
    });
  }

  function openDetail() {
    if (!selectedTrain) return;

    // 黒い通常ヘッダー・下部ナビだけを非表示にする。
    // detail-top（白い乗務区/操作ボタン）は表示したまま。
    setDriverChromeHidden(true);

    if (el.listView) {
      el.listView.hidden = true;
    }

    if (el.detailView) {
      el.detailView.hidden = false;
    }

    renderDetail();
    updateDriverStopAlert();
    enterDriverFullscreen();
  }

  function closeDetail() {
    setDriverChromeHidden(false);

    if (el.detailView) {
      el.detailView.hidden = true;
    }
    document.getElementById("stopAlert")?.setAttribute("hidden", "");

    if (el.listView) {
      el.listView.hidden = false;
    }

    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch?.(() => {});
    }
  }

  // 発着駅・列車番号は長さが列車ごとに異なるため、枠内に収まるよう自動縮小します。
  function fitDetailText(node, maxPx, minPx) {
    if (!node) return;
    node.style.setProperty("--station-size", `${maxPx}px`);
    node.style.fontSize = `${maxPx}px`;
    // レイアウト確定後に幅を測って、必要な場合だけ縮小。
    requestAnimationFrame(() => {
      let size = maxPx;
      const limit = minPx;
      while (size > limit && node.scrollWidth > node.clientWidth + 1) {
        size -= 1;
        node.style.fontSize = `${size}px`;
      }
    });
  }

  function renderDetail() {
    const t = selectedTrain;

    if (!t) return;

    updateRunningLocation();

    if (el.detailCrewName) {
      el.detailCrewName.textContent =
        t.crew ||
        crewForRoute(t.route);
    }

    // ★ 詳細画面にも同じ種別カラーを適用
    applyTrainTypeStyle(
      el.detailType,
      t.type || ""
    );

    if (el.detailCode) {
      // 乗務員画面のコード欄は種別略号ではなく、写真と同じ「M」を表示。
      el.detailCode.textContent = "M";
      el.detailCode.setAttribute("aria-label", "乗務員コード M");
    }

    if (el.detailCars) {
      el.detailCars.value =
        Number.isFinite(Number(t.cars)) && Number(t.cars) > 0 ? String(Number(t.cars)) : "0";
    }

    if (el.detailOrigin) {
      el.detailOrigin.textContent =
        displayStationName(t.origin) || "—";
    }

    if (el.detailDestination) {
      el.detailDestination.textContent =
        displayStationName(t.destination) || "—";
    }

    if (el.detailTrainNo) {
      el.detailTrainNo.textContent =
        t.trainNumber || "—";
    }

    fitDetailText(el.detailOrigin, 32, 20);
    fitDetailText(el.detailDestination, 32, 20);
    fitDetailText(el.detailTrainNo, 40, 25);

    if (el.detailNotice) {
      el.detailNotice.textContent =
        `${getDayTypeLabel(t.dayType)}・${t.route || "路線情報"}・${t.crew || "乗務区情報"}`;
    }

    if (!el.detailSchedule) return;

    el.detailSchedule.innerHTML = "";

    const simulation =
      getSimulation();

    // 同一列車番号・同一ダイヤに複数の乗務区レコードがある場合、
    // 切替地点以降を灰色にします。元の時刻表データは変更しません。
    const sameTrainSegments = trains.filter(x =>
      x && x.trainNumber === t.trainNumber && x.dayType === t.dayType && x.crew && x.crew !== t.crew
    );
    let crewSwitchIndex = -1;
    let switchedCrew = "";
    for (const segment of sameTrainSegments) {
      const first = segment.stops?.[0];
      if (!first) continue;
      const idx = t.stops.findIndex(s => normalizeStationName(s.station) === normalizeStationName(first.station));
      if (idx > 0 && (crewSwitchIndex < 0 || idx < crewSwitchIndex)) {
        crewSwitchIndex = idx;
        switchedCrew = segment.crew;
      }
    }

    t.stops.forEach((stop, i) => {
      const tr = document.createElement("tr");

      if (i === simulation.index) tr.classList.add("detail-current");
      if (crewSwitchIndex >= 0 && i >= crewSwitchIndex) {
        tr.classList.add("detail-crew-switch");
      }

      const distance = i > 0 ? distanceBetweenStops(t.stops[i - 1], stop) : null;
      const cumulative = Number(stop.distanceKm);
      const distanceLabel = distance != null ? `${distance.toFixed(1)} km` : "";
      const cumulativeLabel = Number.isFinite(cumulative) ? `累計 ${cumulative.toFixed(1)} km` : "";
      const mark = i === simulation.index ? "●" : (crewSwitchIndex === i ? "↳" : "");
      tr.innerHTML = `
        <td>${mark}</td>
        <td>${escapeHtml(displayStationName(stop.station))}${crewSwitchIndex === i && switchedCrew ? ` <small class="crew-segment-label">${escapeHtml(switchedCrew)}</small>` : ''}${stop.kind === "pass" ? ' <small class="pass-label">通過</small>' : ''}${distanceLabel ? `<small class="pass-label">${distanceLabel}</small>` : ''}${cumulativeLabel ? `<small class="pass-label">${cumulativeLabel}</small>` : ''}</td>
        <td>${railTimeHtml(stopEventTime(stop), stop.seconds)}</td>
        <td>${stop.kind === "pass" ? railTimeHtml(stopEventTime(stop), stop.seconds) : railTimeHtml(stop.time, stop.seconds)}</td>
      `;

      tr.classList.add("schedule-selectable");
      tr.dataset.stopIndex = String(i);
      tr.setAttribute("role", "button");
      tr.setAttribute("tabindex", "0");
      if (i === selectedScheduleIndex) tr.classList.add("selected-row");

      const selectThisRow = () => {
        selectedScheduleIndex = selectedScheduleIndex === i ? null : i;
        renderDetail();
      };
      tr.addEventListener("click", selectThisRow);
      tr.addEventListener("pointerup", (ev) => {
        // iPadのタッチ操作を確実に拾う。clickとの二重発火は無視する。
        if (ev.pointerType === "touch") {
          ev.preventDefault();
          selectThisRow();
        }
      });
      tr.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectThisRow(); }
      });

      el.detailSchedule.appendChild(tr);
    });
  }

  // =========================================================
  // 次の列車
  // =========================================================

  function renderNextTrains() {
    if (!el.nextTrains) return;

    const dayTrains = getDayFilteredTrains();
    let list = dayTrains.slice(0, 5);

    if (selectedTrain) {
      list = [
        selectedTrain,
        ...dayTrains
          .filter(
            t =>
              t.trainNumber !==
              selectedTrain.trainNumber
          )
          .slice(0, 4)
      ];
    }

    el.nextTrains.innerHTML = "";

    list.slice(0, 5).forEach(train => {
      const div =
        document.createElement("div");

      div.className =
        "next-train-item";

      const typeStyle =
        getTrainTypeStyle(
          train.type || ""
        );

      div.innerHTML = `
        <strong>
          ${escapeHtml(train.trainNumber || "—")}
        </strong>
        <span class="next-train-type">
          ${escapeHtml(typeStyle.label)}
        </span>
        <small>
          ${escapeHtml(displayStationName(train.destination) || "—")}
        </small>
      `;

      // 次列車の種別にも同じ色を適用
      const typeElement =
        div.querySelector(".next-train-type");

      applyTrainTypeStyle(
        typeElement,
        train.type || ""
      );

      div.addEventListener(
        "click",
        () => selectTrain(train, true)
      );

      el.nextTrains.appendChild(div);
    });
  }

  // =========================================================
  // 路線セレクト
  // =========================================================

  function populateLines() {
    const select =
      $("lineSelect");

    if (!select) return;

    const routes =
      [...new Set(
        getDayFilteredTrains()
          .map(t => t.route)
          .filter(Boolean)
      )]
        .sort((a, b) => a.localeCompare(b, "ja"));

    select.innerHTML =
      `<option value="">すべて</option>`;

    routes.forEach(route => {
      const option =
        document.createElement("option");

      option.value = route;
      option.textContent = route;

      select.appendChild(option);
    });
  }

  // =========================================================
  // 時計
  // =========================================================

  function updateClock() {
    const now = new Date();

    const time =
      now.toLocaleTimeString(
        "ja-JP",
        { hour12: false }
      );

    const date =
      now.toLocaleDateString(
        "ja-JP",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          weekday: "short"
        }
      );

    if (el.digital) {
      el.digital.textContent = time;
    }

    if (el.dateText) {
      el.dateText.textContent = date;
    }

    if (el.detailDigital) {
      el.detailDigital.textContent = time;
    }

    if (el.detailDate) {
      el.detailDate.textContent = `${time.slice(0,5)}　${date}`;
    }

    drawAnalog(el.analog, now, 190);
    drawAnalog(el.detailAnalog, now, 240);

    if (selectedTrain) {
      renderRoute();
      renderMetrics();
      renderSchedule();
      renderDetail();
      updateRunningLocation();

      const simulation =
        getSimulation(now);

      if (el.detailCrewState) {
        if (simulation.state === "走行中") {
          el.detailCrewState.textContent =
            "運転中";
        } else if (
          simulation.state === "停車"
        ) {
          el.detailCrewState.textContent =
            "停車中";
        } else if (
          simulation.state === "終着"
        ) {
          el.detailCrewState.textContent =
            "終着";
        } else {
          el.detailCrewState.textContent =
            "発車待ち";
        }
      }

      if (el.positionUpdated) {
        el.positionUpdated.textContent =
          "更新 " + time;
      }

      if (el.lastUpdated) {
        el.lastUpdated.textContent =
          "更新 " + time;
      }
    }
  }

  function drawAnalog(canvas, date, size) {
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const w = size;
    const h = size;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = w * 0.41;
    const isDriverClock = canvas === el.detailAnalog;
    const ink = isDriverClock ? "#222" : (darkMode ? "#8da0b5" : "#333");
    const hand = isDriverClock ? "#222" : (darkMode ? "#d9e3ef" : "#222");

    // 外周
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = isDriverClock ? 2.5 : 3;
    ctx.stroke();

    // 60分目盛り
    for (let i = 0; i < 60; i++) {
      const angle = i * Math.PI / 30 - Math.PI / 2;
      const major = i % 5 === 0;
      const outer = radius * 0.98;
      const inner = radius * (major ? 0.88 : 0.93);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = ink;
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
    }

    // 数字（乗務員画面は参照写真に合わせて表示）
    if (isDriverClock) {
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(11, Math.round(size * 0.075))}px Arial, sans-serif`;
      for (let n = 1; n <= 12; n++) {
        const angle = n * Math.PI / 6 - Math.PI / 2;
        const nr = radius * 0.76;
        ctx.fillText(String(n), cx + Math.cos(angle) * nr, cy + Math.sin(angle) * nr);
      }
    }

    const hour = date.getHours() % 12;
    const minute = date.getMinutes();
    const second = date.getSeconds();

    drawHand(ctx, cx, cy, radius * 0.50,
      (hour + minute / 60) * Math.PI / 6 - Math.PI / 2, isDriverClock ? 4 : 5, hand);
    drawHand(ctx, cx, cy, radius * 0.72,
      minute * Math.PI / 30 - Math.PI / 2, isDriverClock ? 3 : 3, hand);
    drawHand(ctx, cx, cy, radius * 0.80,
      second * Math.PI / 30 - Math.PI / 2, 1, isDriverClock ? "#777" : hand);

    ctx.beginPath();
    ctx.arc(cx, cy, isDriverClock ? 3 : 4, 0, Math.PI * 2);
    ctx.fillStyle = hand;
    ctx.fill();
  }

  function drawHand(ctx, cx, cy, length, angle, width, color) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    ctx.lineWidth = width;
    ctx.strokeStyle = color || "#222";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // =========================================================
  // 検索結果
  // =========================================================

  function showSearchResult(
    number,
    message
  ) {
    if (!el.trainSearchResult) return;

    el.trainSearchResult.innerHTML = `
      <div class="search-result-card">
        <strong>
          ${escapeHtml(number || "列車検索")}
        </strong>
        <span>
          ${escapeHtml(message)}
        </span>
      </div>
    `;
  }

  function setStatus(text) {
    if (el.dataStatus) {
      el.dataStatus.textContent = text;
    }
  }

  // =========================================================
  // 運転台：停車30秒前表示 + シミュレーター
  // =========================================================

  function driverNowSeconds() {
    if (stopSimMode && Number.isFinite(stopSimSeconds)) return stopSimSeconds;
    const n = new Date();
    return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
  }

  function stopArrivalSeconds(stop) {
    const v = stop?.arrival || stop?.time || "";
    const sec = timeToSeconds(v);
    return Number.isFinite(sec) ? sec : NaN;
  }

  function stopDepartureSeconds(stop) {
    const v = stop?.departure || stop?.time || "";
    const sec = timeToSeconds(v);
    return Number.isFinite(sec) ? sec : NaN;
  }

  function findUpcomingStopForAlert() {
    if (!selectedTrain?.stops?.length) return null;
    const now = driverNowSeconds();
    let best = null;
    selectedTrain.stops.forEach((stop, index) => {
      const a = stopArrivalSeconds(stop);
      if (!Number.isFinite(a)) return;
      // 日跨ぎ（例 23:59→00:03）にもある程度対応
      let diff = a - now;
      if (diff < -43200) diff += 86400;
      if (diff >= -5 && diff <= 86400) {
        if (!best || diff < best.diff) best = { stop, index, diff, arrival: a };
      }
    });
    return best;
  }

  function formatDriverTime(v) {
    const s = timeToSeconds(v);
    if (!Number.isFinite(s)) return "--:--:--";
    const h = Math.floor(s / 3600) % 24;
    const m = Math.floor(s / 60) % 60;
    const sec = s % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  }

  function getAlertTimes(stop) {
    // 新しいJSONで arrival/departure が分かれていればそのまま使用。
    // 従来JSONは time の値を着発の基準値として使用し、勝手な時刻は生成しません。
    const arrival = stop?.arrival || stop?.time || "";
    const departure = stop?.departure || stop?.time || "";
    return { arrival: formatDriverTime(arrival), departure: formatDriverTime(departure) };
  }

  function stopAlertKey(stop, index) {
    const station = normalizeStationName(stop?.station || "");
    const arrival = stop?.arrival || stop?.time || "";
    return `${index}|${station}|${arrival}`;
  }

  function updateDriverStopAlert() {
    const box = document.getElementById("stopAlert");
    if (!box || !selectedTrain || el.detailView?.hidden) {
      if (box) box.hidden = true;
      return;
    }

    const now = driverNowSeconds();
    let candidate = null;

    selectedTrain.stops.forEach((stop, index) => {
      const a = stopArrivalSeconds(stop);
      if (!Number.isFinite(a)) return;

      let delta = a - now;
      if (delta < -43200) delta += 86400;

      const d = stopDepartureSeconds(stop);
      let departure = d;
      if (Number.isFinite(departure) && departure < a) departure += 86400;

      // 表示開始は「到着30秒前」。到着後は発車時刻まで表示。
      const inWindow = delta <= 30 && delta >= 0;
      const dwell = Number.isFinite(departure) && now >= a && now < departure;

      if (inWindow || dwell) {
        if (!candidate || delta < candidate.delta) {
          candidate = { stop, index, delta, arrival: a, departure };
        }
      }
    });

    if (!candidate) {
      box.hidden = true;
      alertStopIndex = -1;
      // 停車イベントを抜けたら、次回の同駅イベントを再利用可能にする。
      confirmedStopKey = "";
      return;
    }

    const stop = candidate.stop;
    const key = stopAlertKey(stop, candidate.index);

    // 「停車確認」済みの現在停車イベントは、発車するまで再表示しない。
    if (confirmedStopKey === key) {
      box.hidden = true;
      alertStopIndex = candidate.index;
      return;
    }

    if (alertStopIndex !== candidate.index) {
      alertStopIndex = candidate.index;
      const button = document.getElementById("stopConfirmButton");
      if (button) {
        button.textContent = "停車確認";
        button.classList.remove("confirmed");
      }
    }

    // iPad/SafariでCSSの競合やキャッシュによりボタンが消えるケースを避けるため、
    // 表示するたびにボタンの存在と表示状態をDOM側でも保証する。
    let confirmButton = document.getElementById("stopConfirmButton");
    if (!confirmButton && box) {
      confirmButton = document.createElement("button");
      confirmButton.id = "stopConfirmButton";
      confirmButton.type = "button";
      confirmButton.textContent = "停車確認";
      const panel = box.querySelector(".driver-stop-panel");
      if (panel) panel.appendChild(confirmButton);
      confirmButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (selectedTrain?.stops?.length && alertStopIndex >= 0) {
          const s = selectedTrain.stops[alertStopIndex];
          if (s) confirmedStopKey = stopAlertKey(s, alertStopIndex);
        }
        box.hidden = true;
      });
    }
    if (confirmButton) {
      confirmButton.hidden = false;
      confirmButton.disabled = false;
      confirmButton.textContent = "停車確認";
      confirmButton.style.setProperty("display", "block", "important");
      confirmButton.style.setProperty("visibility", "visible", "important");
      confirmButton.style.setProperty("opacity", "1", "important");
      confirmButton.style.setProperty("position", "absolute", "important");
      confirmButton.style.setProperty("left", "12px", "important");
      confirmButton.style.setProperty("right", "12px", "important");
      confirmButton.style.setProperty("bottom", "12px", "important");
      confirmButton.style.setProperty("width", "calc(100% - 24px)", "important");
      confirmButton.style.setProperty("height", "58px", "important");
      confirmButton.style.setProperty("min-height", "58px", "important");
      confirmButton.style.setProperty("z-index", "9999", "important");
      confirmButton.style.setProperty("background", "#ffd400", "important");
      confirmButton.style.setProperty("color", "#111", "important");
      confirmButton.style.setProperty("font-size", "24px", "important");
      confirmButton.style.setProperty("font-weight", "700", "important");
      confirmButton.style.setProperty("pointer-events", "auto", "important");
    }

    const times = getAlertTimes(stop);
    // 両数はPDF/停車データの値を一切使用せず、運転画面で手入力した値だけを使用。
    const manualCars = Number.isFinite(Number(selectedTrain?.cars)) && Number(selectedTrain.cars) > 0
      ? Number(selectedTrain.cars)
      : 0;

    document.getElementById("alertCars").textContent = String(manualCars);
    document.getElementById("alertStation").textContent =
      `${displayStationName(stop.station)}停車`;
    document.getElementById("alertArrival").textContent = times.arrival;
    document.getElementById("alertDeparture").textContent = times.departure;

    box.hidden = false;
  }

  function setStopSimSeconds(sec) {
    stopSimSeconds = ((Math.floor(sec) % 86400) + 86400) % 86400;
    const input = document.getElementById("stopSimTime");
    if (input) input.value = `${String(Math.floor(stopSimSeconds/3600)).padStart(2,"0")}:${String(Math.floor(stopSimSeconds/60)%60).padStart(2,"0")}:${String(stopSimSeconds%60).padStart(2,"0")}`;
    const readout = document.getElementById("stopSimReadout");
    if (readout) readout.textContent = formatDriverTime(secondsToHms(stopSimSeconds));
    updateDriverStopAlert();
  }

  function secondsToHms(sec) { return formatDriverTime(sec); }

  function openStopSimulator() {
    const dialog = document.getElementById("stopSimDialog");
    if (!dialog) return;
    const now = driverNowSeconds();
    stopSimSeconds = now;
    setStopSimSeconds(now);
    dialog.showModal();
  }

  function jumpToNextStopAlert() {
    if (!selectedTrain?.stops?.length) return;
    const now = driverNowSeconds();
    let best = null;
    selectedTrain.stops.forEach((stop, index) => {
      const a = stopArrivalSeconds(stop);
      if (!Number.isFinite(a)) return;
      let diff = a - now;
      if (diff <= 0) diff += 86400;
      if (!best || diff < best.diff) best = { stop, index, a, diff };
    });
    if (!best) return;
    stopSimMode = true;
    stopSimRunning = false;
    setStopSimSeconds(best.a - 30);
    updateDriverStopAlert();
  }

  // 両数は画面上の「○両」の数字部分そのものへ直接入力します。
  // 専用の手入力欄は使いません。iPad/Safariでも確実に入力できるよう
  // contenteditableではなく、数字inputを「数字だけ」に見えるようCSSで整えます。
  function initDirectCarsInput() {
    const target = document.getElementById("detailCars");
    if (!target) return;

    target.type = "number";
    target.inputMode = "numeric";
    target.min = "0";
    target.max = "20";
    target.step = "1";

    const apply = () => {
      if (!selectedTrain) return;
      let n = Number(target.value);
      if (!Number.isFinite(n) || n < 0) n = 0;
      n = Math.min(20, Math.floor(n));
      target.value = String(n);
      selectedTrain.cars = n > 0 ? n : null;

      if (el.cars) {
        el.cars.textContent = n > 0 ? `${n}両` : "0両";
      }
      updateDriverStopAlert();
    };

    target.addEventListener("input", apply);
    target.addEventListener("change", apply);
    target.addEventListener("focus", () => {
      // iPadではタップした時に数字キーボードを開き、現在値を選択。
      try { target.select(); } catch (_) {}
    });
    target.addEventListener("click", (ev) => ev.stopPropagation());
    target.addEventListener("keydown", (ev) => {
      if (["e", "E", "+", "-", "."].includes(ev.key)) ev.preventDefault();
      if (ev.key === "Enter") {
        ev.preventDefault();
        target.blur();
      }
    });
  }

  function initStopSimulator() {
    document.getElementById("stopSimOpen")?.addEventListener("click", openStopSimulator);
    document.getElementById("stopSimClose")?.addEventListener("click", () => document.getElementById("stopSimDialog")?.close());
    document.getElementById("stopSimDialog")?.addEventListener("close", () => { stopSimRunning = false; });
    document.getElementById("stopSimTime")?.addEventListener("change", e => {
      const s = timeToSeconds(e.target.value);
      if (Number.isFinite(s)) { stopSimMode = true; setStopSimSeconds(s); }
    });
    document.getElementById("stopSimMinus")?.addEventListener("click", () => { stopSimMode = true; setStopSimSeconds((stopSimSeconds ?? driverNowSeconds()) - 30); });
    document.getElementById("stopSimPlus")?.addEventListener("click", () => { stopSimMode = true; setStopSimSeconds((stopSimSeconds ?? driverNowSeconds()) + 30); });
    document.getElementById("stopSimEvent")?.addEventListener("click", jumpToNextStopAlert);
    document.getElementById("stopSimPlay")?.addEventListener("click", () => { stopSimMode = true; stopSimRunning = true; });
    document.getElementById("stopSimPause")?.addEventListener("click", () => { stopSimRunning = false; });
    document.querySelectorAll("[data-stop-speed]").forEach(btn => btn.addEventListener("click", () => {
      stopSimSpeed = Number(btn.dataset.stopSpeed) || 1;
      document.querySelectorAll("[data-stop-speed]").forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
    }));
    document.getElementById("stopConfirmButton")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const b = document.getElementById("stopConfirmButton");
      const box = document.getElementById("stopAlert");

      // 現在表示中の停車イベントを確定済みにする。
      // updateDriverStopAlert() が毎秒走っても、発車するまで再表示しません。
      if (selectedTrain?.stops?.length && alertStopIndex >= 0) {
        const stop = selectedTrain.stops[alertStopIndex];
        if (stop) confirmedStopKey = stopAlertKey(stop, alertStopIndex);
      }

      if (box) box.hidden = true;
      if (b) {
        b.textContent = "停車確認";
        b.classList.remove("confirmed");
      }
    });
    document.querySelector('[data-stop-speed="1"]')?.classList.add("selected");
  }

  function stopSimulatorLoop() {
    if (stopSimMode && stopSimRunning) {
      setStopSimSeconds((stopSimSeconds ?? driverNowSeconds()) + stopSimSpeed);
    }
    updateDriverStopAlert();
    setTimeout(stopSimulatorLoop, 1000);
  }

  // =========================================================
  // UIイベント
  // =========================================================

  el.dayTypeSelect?.addEventListener("change", e => {
    setActiveDayType(e.target.value, false);
  });

  el.dayTypeAutoBtn?.addEventListener("click", () => {
    const next = getAutoDayType();
    setActiveDayType(next, true);
  });

  el.trainSearchBtn?.addEventListener(
    "click",
    searchTrain
  );

  el.trainNumberInput?.addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") {
        searchTrain();
      }
    }
  );

  $("backBtn")?.addEventListener(
    "click",
    closeDetail
  );

  $("detailBack")?.addEventListener(
    "click",
    closeDetail
  );

  $("refreshBtn")?.addEventListener(
    "click",
    () => loadData()
  );

  $("themeBtn")?.addEventListener(
    "click",
    toggleTheme
  );

  $("detailTheme")?.addEventListener(
    "click",
    toggleTheme
  );

  $("zoomIn")?.addEventListener(
    "click",
    () => changeZoom(0.1)
  );

  $("zoomOut")?.addEventListener(
    "click",
    () => changeZoom(-0.1)
  );

  $("detailZoomIn")?.addEventListener(
    "click",
    () => changeZoom(0.1)
  );

  $("detailZoomOut")?.addEventListener(
    "click",
    () => changeZoom(-0.1)
  );

  $("fullscreenBtn")?.addEventListener(
    "click",
    () => {
      if (!document.fullscreenElement) {
        document.documentElement
          .requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
  );

  $("menuBtn")?.addEventListener(
    "click",
    () => {
      $("menuDialog")?.showModal();
    }
  );

  $("closeDialog")?.addEventListener(
    "click",
    () => {
      $("menuDialog")?.close();
    }
  );

  $("officialBtn")?.addEventListener(
    "click",
    () => {
      window.open(
        "https://www.meitetsu.co.jp/train/operation/",
        "_blank"
      );
    }
  );

  $("officialMenu")?.addEventListener(
    "click",
    () => {
      window.open(
        "https://www.meitetsu.co.jp/train/operation/",
        "_blank"
      );
    }
  );

  // =========================================================
  // 種別フィルター
  // =========================================================

  function setupTypeFilters() {
    document
      .querySelectorAll(
        ".filter, .quick"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const type =
              button.dataset.type ||
              button.getAttribute("data-train-type");

            if (!type) return;

            document
              .querySelectorAll(
                ".filter, .quick"
              )
              .forEach(x =>
                x.classList.remove("active")
              );

            button.classList.add("active");

            if (type === "all") {
              return;
            }

            const train =
              trains.find(
                t => t.type === type
              );

            if (train) {
              selectTrain(train, false);
            }
          }
        );
      });
  }

  // =========================================================
  // テーマ・ズーム
  // =========================================================

  function toggleTheme() {
    darkMode = !darkMode;

    document.body.classList.toggle(
      "light-mode",
      !darkMode
    );

    updateClock();
  }

  function changeZoom(delta) {
    zoom += delta;

    zoom =
      Math.max(
        0.8,
        Math.min(1.4, zoom)
      );

    document.documentElement.style.setProperty(
      "--app-zoom",
      zoom
    );
  }

  // =========================================================
  // XSS対策
  // =========================================================

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // =========================================================
  // 起動
  // =========================================================

  setupTypeFilters();

  updateClock();

  setInterval(
    updateClock,
    1000
  );

  if (dayTypeAuto) activeDayType = getAutoDayType();
  updateDayTypeStatus();
  initDirectCarsInput();
  initStopSimulator();
  stopSimulatorLoop();

  loadData();

})();

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
  const TRAIN_METADATA_OVERRIDES = {
    "299": { type: "特急", destination: "名鉄名古屋", cars: 6 }
  };

  let trains = [];
  let selectedTrain = null;
  let darkMode = true;
  let zoom = 1;

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

    // 共通の種別表示形状
    element.style.display = "inline-flex";
    element.style.alignItems = "center";
    element.style.justifyContent = "center";
    element.style.fontWeight = "900";
    element.style.borderStyle = "solid";
    element.style.borderWidth = "1px";
    element.style.borderRadius = "6px";

    // 普通は既存デザインを維持
    if (type === "普通" || !style.background) {
      element.style.removeProperty("background-color");
      element.style.removeProperty("color");
      element.style.removeProperty("border-color");
      element.style.removeProperty("box-shadow");
      element.removeAttribute("data-train-type");
      return;
    }

    element.style.backgroundColor = style.background;
    element.style.color = style.color;
    element.style.borderColor = style.border;
    element.dataset.trainType = type;

    // 次列車欄は少しコンパクトに
    if (element.classList.contains("next-train-type")) {
      element.style.padding = "3px 7px";
      element.style.fontSize = "11px";
      element.style.lineHeight = "1.2";
    }

    // 白背景の種別は輪郭を少し見やすくする
    if (style.background === "#ffffff") {
      element.style.boxShadow = `0 0 0 1px ${style.border}`;
    } else {
      element.style.boxShadow = `0 0 10px ${style.background}33`;
    }
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

      const real299 = findTrain("299");

      if (real299) {
        selectTrain(real299, false);
        showSearchResult(
          "299",
          "公式時刻表データから299を取得しました。"
        );
      } else {
        selectedTrain = null;
        showSearchResult("299", "299は現在の公式時刻表データにありません。");
      }

    } catch (error) {
      console.error(error);

      setStatus("時刻表データを読み込めませんでした。");
      trains = [];
      selectedTrain = null;
      showSearchResult("299", "時刻表データを読み込めませんでした。");
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

        cars: Number.isFinite(Number(override.cars))
          ? Number(override.cars)
          : (Number.isFinite(Number(train.cars)) ? Number(train.cars) : null),

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
    if (s.length < 2 || s.length > 20) return "";
    return s;
  }

  function normalizeStops(train) {
    if (Array.isArray(train.stops)) {
      const result = [];

      for (const x of train.stops) {
        const station = normalizeStationName(x.station ?? x.name ?? "");
        const time = normalizeTime(
          x.time ?? x.arrival ?? x.departure ?? ""
        );

        if (!station || !time) continue;

        const prev = result[result.length - 1];
        if (prev && prev.station === station && prev.time === time) continue;

        result.push({ station, time });
      }

      return result;
    }

    if (
      Array.isArray(train.stations) &&
      Array.isArray(train.times)
    ) {
      const result = [];

      train.stations.forEach((station, i) => {
        const name = normalizeStationName(station);
        const time = normalizeTime(train.times[i]);

        if (!name || !time) return;

        const prev = result[result.length - 1];
        if (prev && prev.station === name && prev.time === time) return;

        result.push({ station: name, time });
      });

      return result;
    }

    return [];
  }

  function normalizeTime(value) {
    if (!value) return "";

    const s = collapseDuplicateGlyphs(String(value).trim());

    if (/^\d{1,2}:\d{2}$/.test(s)) {
      const [h, m] = s.split(":");
      return `${Number(h)}:${m}`;
    }

    if (/^\d{3,4}$/.test(s)) {
      if (s.length === 3) {
        return `${Number(s[0])}:${s.slice(1)}`;
      }

      return `${Number(s.slice(0, 2))}:${s.slice(2)}`;
    }

    return "";
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
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds()/60;
    const scored = candidates.map(train => {
      const first = train.stops?.[0]?.time;
      const last = train.stops?.[train.stops.length - 1]?.time;
      const a = first ? timeToMinutes(first) : Infinity;
      const b = last ? timeToMinutes(last) : -Infinity;
      let rank = 2;
      if (nowMin >= a && nowMin <= b) rank = 0;
      else if (a > nowMin) rank = 1;
      return { train, rank, distance: rank === 1 ? a-nowMin : rank === 2 ? nowMin-b : 0 };
    });
    scored.sort((x,y) => x.rank-y.rank || x.distance-y.distance);
    return scored[0]?.train || candidates[0];
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
    selectedTrain = {
      ...train,
      dayType: normalizeDayType(train.dayType),
      crew:
        train.crew ||
        crewForRoute(train.route)
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
        Number.isFinite(Number(t.cars)) ? `${Number(t.cars)}両` : "—";
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
          <td>${escapeHtml(shownTime)}</td>
          <td>${stop.kind === "pass" ? escapeHtml(shownTime) : escapeHtml(stop.time || "—")}</td>
          <td>${distanceText}${escapeHtml(status)}</td>
          <td>${i === simulation.index ? "●" : ""}</td>
        `;

        if (i === simulation.index) {
          tr.classList.add("current-row");
        }

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
    enterDriverFullscreen();
  }

  function closeDetail() {
    setDriverChromeHidden(false);

    if (el.detailView) {
      el.detailView.hidden = true;
    }

    if (el.listView) {
      el.listView.hidden = false;
    }

    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch?.(() => {});
    }
  }

  function renderDetail() {
    const t = selectedTrain;

    if (!t) return;

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
      el.detailCode.textContent =
        serviceCode(t.type);
    }

    if (el.detailCars) {
      el.detailCars.textContent =
        Number.isFinite(Number(t.cars)) ? Number(t.cars) : "—";
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

    if (el.detailNotice) {
      el.detailNotice.textContent =
        `${getDayTypeLabel(t.dayType)}・${t.route || "路線情報"}・${t.crew || "乗務区情報"}`;
    }

    if (!el.detailSchedule) return;

    el.detailSchedule.innerHTML = "";

    const simulation =
      getSimulation();

    t.stops.forEach((stop, i) => {
      const tr =
        document.createElement("tr");

      if (i === simulation.index) {
        tr.classList.add("detail-current");
      }

      const distance = i > 0 ? distanceBetweenStops(t.stops[i - 1], stop) : null;
      const cumulative = Number(stop.distanceKm);
      const distanceLabel = distance != null ? `${distance.toFixed(1)} km` : "";
      const cumulativeLabel = Number.isFinite(cumulative) ? `累計 ${cumulative.toFixed(1)} km` : "";
      tr.innerHTML = `
        <td>${i === simulation.index ? "●" : ""}</td>
        <td>${escapeHtml(displayStationName(stop.station))}${stop.kind === "pass" ? ' <small class="pass-label">通過</small>' : ''}${distanceLabel ? `<small class="pass-label">${distanceLabel}</small>` : ''}${cumulativeLabel ? `<small class="pass-label">${cumulativeLabel}</small>` : ''}</td>
        <td>${escapeHtml(displayStopTime(stop))}</td>
        <td>${stop.kind === "pass" ? escapeHtml(displayStopTime(stop)) : escapeHtml(stop.time || "—")}</td>
      `;

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

    drawAnalog(el.analog, now, 190);
    drawAnalog(el.detailAnalog, now, 220);

    if (selectedTrain) {
      renderRoute();
      renderMetrics();
      renderSchedule();
      renderDetail();

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

    const ctx =
      canvas.getContext("2d");

    const w = size;
    const h = size;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = w * 0.39;

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius,
      0,
      Math.PI * 2
    );

    ctx.strokeStyle =
      darkMode ? "#8da0b5" : "#333";

    ctx.lineWidth = 3;
    ctx.stroke();

    for (let i = 0; i < 12; i++) {
      const angle =
        i * Math.PI / 6;

      const x1 =
        cx +
        Math.cos(angle) *
        radius *
        0.88;

      const y1 =
        cy +
        Math.sin(angle) *
        radius *
        0.88;

      const x2 =
        cx +
        Math.cos(angle) *
        radius *
        0.98;

      const y2 =
        cy +
        Math.sin(angle) *
        radius *
        0.98;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const hour =
      date.getHours() % 12;

    const minute =
      date.getMinutes();

    const second =
      date.getSeconds();

    drawHand(
      ctx,
      cx,
      cy,
      radius * 0.5,
      (
        hour +
        minute / 60
      ) *
        Math.PI /
        6 -
        Math.PI / 2,
      5
    );

    drawHand(
      ctx,
      cx,
      cy,
      radius * 0.72,
      minute *
        Math.PI /
        30 -
        Math.PI / 2,
      3
    );

    drawHand(
      ctx,
      cx,
      cy,
      radius * 0.8,
      second *
        Math.PI /
        30 -
        Math.PI / 2,
      1
    );
  }

  function drawHand(
    ctx,
    cx,
    cy,
    length,
    angle,
    width
  ) {
    ctx.beginPath();

    ctx.moveTo(cx, cy);

    ctx.lineTo(
      cx +
        Math.cos(angle) *
        length,
      cy +
        Math.sin(angle) *
        length
    );

    ctx.lineWidth = width;

    ctx.strokeStyle =
      darkMode ? "#d9e3ef" : "#222";

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
  loadData();

})();

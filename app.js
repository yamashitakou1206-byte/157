(() => {
  "use strict";

  const DATA_URL = "data/timetables.json";

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
    }
  };

  // =========================================================
  // 動作確認用299
  // 実データに299が存在すれば自動的に実データへ切り替えます
  // =========================================================
  const DEMO_299 = {
    trainNumber: "299",
    type: "快速特急",
    origin: "名鉄岐阜",
    destination: "豊橋",
    route: "名古屋本線",
    crew: "名古屋乗務区",
    stops: [
      { station: "名鉄岐阜", time: "10:00" },
      { station: "名鉄一宮", time: "10:15" },
      { station: "国府宮", time: "10:21" },
      { station: "名古屋", time: "10:35" },
      { station: "金山", time: "10:42" },
      { station: "知立", time: "11:05" },
      { station: "豊橋", time: "11:25" }
    ]
  };

  let trains = [];
  let selectedTrain = null;
  let darkMode = true;
  let zoom = 1;

  const $ = id => document.getElementById(id);

  const el = {
    digital: $("digital"),
    dateText: $("dateText"),

    trainNumberInput: $("trainNumberInput"),
    trainSearchBtn: $("trainSearchBtn"),
    trainSearchResult: $("trainSearchResult"),
    dataStatus: $("dataStatus"),

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
      TRAIN_TYPE_STYLE["普通"]
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

  async function loadData() {
    setStatus("時刻表データを読み込み中…");

    try {
      const response = await fetch(DATA_URL, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const json = await response.json();

      if (Array.isArray(json)) {
        trains = json;
      } else if (Array.isArray(json.trains)) {
        trains = json.trains;
      } else {
        trains = [];
      }

      normalizeAllTrains();

      setStatus(
        `時刻表データ読込完了　${trains.length.toLocaleString()}列車`
      );

      const real299 = findTrain("299");

      if (real299) {
        selectTrain(real299, false);
        showSearchResult(
          "299",
          "公式時刻表データから299を取得しました。"
        );
      } else {
        selectTrain(DEMO_299, false);
        showSearchResult(
          "299",
          "現在のJSONに299がないため、動作確認用データを表示しています。"
        );
      }

    } catch (error) {
      console.error(error);

      setStatus(
        "時刻表データを読み込めませんでした。デモ列車で起動します。"
      );

      trains = [];
      selectTrain(DEMO_299, false);

      showSearchResult(
        "299",
        "データ取得エラーのため、動作確認用299を表示しています。"
      );
    }

    populateLines();
    renderNextTrains();
  }

  function normalizeAllTrains() {
    trains = trains.map(train => {
      const stops = normalizeStops(train);

      return {
        ...train,

        trainNumber: String(
          train.trainNumber ??
          train.number ??
          ""
        ).trim(),

        type: train.type || "普通",

        origin:
          train.origin ||
          (stops[0] ? stops[0].station : ""),

        destination:
          train.destination ||
          (stops.length
            ? stops[stops.length - 1].station
            : ""),

        route: train.route || "",

        crew:
          train.crew ||
          crewForRoute(train.route || ""),

        stops
      };
    });
  }

  function collapsePdfDuplicateGlyphs(value) {
    const s = String(value ?? "").trim().replace(/\s+/g, "");
    if (s.length >= 4 && s.length % 2 === 0) {
      let ok = true;
      for (let i = 0; i < s.length; i += 2) {
        if (s[i] !== s[i + 1]) { ok = false; break; }
      }
      if (ok) return s.slice(0).split("").filter((_, i) => i % 2 === 0).join("");
    }
    return s;
  }

  function normalizeStationName(value) {
    let s = collapsePdfDuplicateGlyphs(value);
    s = s.replace(/中中部部国国際際空空港港/g, "中部国際空港");
    s = s.replace(/中中部部国国/g, "中部国");
    s = s.replace(/際際空空港港/g, "際空港");
    return s;
  }

  function normalizeStops(train) {
    if (Array.isArray(train.stops)) {
      return train.stops
        .map(x => ({
          station: String(
            x.station ??
            x.name ??
            ""
          ).trim(),

          time: normalizeTime(
            x.time ??
            x.arrival ??
            x.departure ??
            ""
          )
        }))
        .filter(x => x.station && x.time);
    }

    if (
      Array.isArray(train.stations) &&
      Array.isArray(train.times)
    ) {
      return train.stations
        .map((station, i) => ({
          station: String(station).trim(),
          time: normalizeTime(train.times[i])
        }))
        .filter(x => x.station && x.time);
    }

    return [];
  }

  function normalizeTime(value) {
    if (!value) return "";

    const s = String(value).trim();

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

  function findTrainCandidates(number) {
    const target = String(number).trim().toUpperCase();
    if (!target) return [];
    return trains.filter(train =>
      String(train.trainNumber).trim().toUpperCase() === target
    );
  }

  function findTrain(number) {
    const candidates = findTrainCandidates(number);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const selectedLine = el.lineSelect?.value || "";

    function distanceToSchedule(train) {
      const stops = Array.isArray(train.stops) ? train.stops : [];
      if (!stops.length) return 999999;
      const first = timeToMinutes(stops[0].time);
      const last = timeToMinutes(stops[stops.length - 1].time);
      let score;
      if (nowMin >= first && nowMin <= last) {
        score = 0;
      } else if (nowMin < first) {
        score = 1000 + (first - nowMin);
      } else {
        score = 2000 + (nowMin - last);
      }
      if (selectedLine && String(train.route || "").includes(selectedLine)) {
        score -= 100;
      }
      return score;
    }

    return candidates.slice().sort((a, b) => distanceToSchedule(a) - distanceToSchedule(b))[0];
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

    if (number.toUpperCase() === "299") {
      selectTrain(DEMO_299, true);

      showSearchResult(
        "299",
        "現在の時刻表JSONには299がないため、動作確認用データを表示しています。"
      );

      return;
    }

    showSearchResult(
      number,
      "この列車番号は現在のデータにありません。"
    );
  }

  // =========================================================
  // 列車選択
  // =========================================================

  function selectTrain(train, detail) {
    selectedTrain = {
      ...train,
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
      t.type || "普通"
    );

    if (el.serviceCode) {
      el.serviceCode.textContent =
        serviceCode(t.type);
    }

    if (el.cars) {
      el.cars.textContent =
        carsForType(t.type) + "両";
    }

    if (el.origin) {
      el.origin.textContent =
        t.origin || "—";
    }

    if (el.destination) {
      el.destination.textContent =
        t.destination || "—";
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

  function carsForType(type) {
    if (type === "ミュースカイ") return 8;
    if (type === "快速特急") return 6;
    if (type === "特急") return 6;
    return 4;
  }

  // =========================================================
  // 現在位置計算
  // =========================================================

  function getSimulation(now = new Date()) {
    if (!selectedTrain || !selectedTrain.stops.length) {
      return {
        index: -1,
        nextIndex: -1,
        progress: 0,
        state: "待機"
      };
    }

    const stops = selectedTrain.stops;

    const currentMinutes =
      now.getHours() * 60 +
      now.getMinutes() +
      now.getSeconds() / 60;

    const times =
      stops.map(s => timeToMinutes(s.time));

    if (currentMinutes < times[0]) {
      return {
        index: -1,
        nextIndex: 0,
        progress: 0,
        state: "発車待ち"
      };
    }

    if (
      currentMinutes >=
      times[times.length - 1]
    ) {
      return {
        index: times.length - 1,
        nextIndex: -1,
        progress: 1,
        state: "終着"
      };
    }

    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i];
      const b = times[i + 1];

      if (
        currentMinutes >= a &&
        currentMinutes < b
      ) {
        const progress =
          (currentMinutes - a) /
          Math.max(0.01, b - a);

        const isStation =
          Math.abs(currentMinutes - a) < 0.05;

        return {
          index: i,
          nextIndex: i + 1,
          progress,
          state: isStation
            ? "停車"
            : "走行中"
        };
      }
    }

    return {
      index: 0,
      nextIndex: 1,
      progress: 0,
      state: "走行中"
    };
  }

  function timeToMinutes(time) {
    const [h, m] =
      String(time).split(":").map(Number);

    return h * 60 + m;
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

      node.innerHTML = `
        <div class="station-dot"></div>
        <div class="station-name">
          ${escapeHtml(stop.station)}
        </div>
        <div class="station-time">
          ${escapeHtml(stop.time)}
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
          status = "通過済";
        } else if (
          i === simulation.index
        ) {
          status =
            simulation.state === "停車"
              ? "停車中"
              : "現在位置";
        } else if (
          i === simulation.nextIndex
        ) {
          status = "次駅";
        } else {
          status = "これから";
        }

        tr.innerHTML = `
          <td>${escapeHtml(stop.station)}</td>
          <td>${escapeHtml(stop.time)}</td>
          <td>${escapeHtml(stop.time)}</td>
          <td>${escapeHtml(status)}</td>
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
      el.metricLine.textContent =
        selectedTrain.route ||
        "路線情報";
    }

    if (el.metricNext) {
      el.metricNext.textContent =
        next
          ? next.time
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
          ? `現在位置：${current.station}`
          : "現在位置：始発待ち";
    }

    if (el.nextStop) {
      el.nextStop.textContent =
        next
          ? `次駅：${next.station}`
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
        selectedTrain.stops[nextIndex].time
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

  function openDetail() {
    if (!selectedTrain) return;

    if (el.listView) {
      el.listView.hidden = true;
    }

    if (el.detailView) {
      el.detailView.hidden = false;
    }

    renderDetail();
  }

  function closeDetail() {
    if (el.detailView) {
      el.detailView.hidden = true;
    }

    if (el.listView) {
      el.listView.hidden = false;
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
      t.type || "普通"
    );

    if (el.detailCode) {
      el.detailCode.textContent =
        serviceCode(t.type);
    }

    if (el.detailCars) {
      el.detailCars.textContent =
        carsForType(t.type);
    }

    if (el.detailOrigin) {
      el.detailOrigin.textContent =
        t.origin || "—";
    }

    if (el.detailDestination) {
      el.detailDestination.textContent =
        t.destination || "—";
    }

    if (el.detailTrainNo) {
      el.detailTrainNo.textContent =
        t.trainNumber || "—";
    }

    if (el.detailNotice) {
      el.detailNotice.textContent =
        `${t.route || "路線情報"}・${t.crew || "乗務区情報"}`;
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

      tr.innerHTML = `
        <td>${i === simulation.index ? "●" : ""}</td>
        <td>${escapeHtml(stop.station)}</td>
        <td>${escapeHtml(stop.time)}</td>
        <td>${escapeHtml(stop.time)}</td>
      `;

      el.detailSchedule.appendChild(tr);
    });
  }

  // =========================================================
  // 次の列車
  // =========================================================

  function renderNextTrains() {
    if (!el.nextTrains) return;

    let list = trains.slice(0, 5);

    if (selectedTrain) {
      list = [
        selectedTrain,
        ...trains
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
          train.type || "普通"
        );

      div.innerHTML = `
        <strong>
          ${escapeHtml(train.trainNumber || "—")}
        </strong>
        <span class="next-train-type">
          ${escapeHtml(typeStyle.label)}
        </span>
        <small>
          ${escapeHtml(train.destination || "—")}
        </small>
      `;

      // 次列車の種別にも同じ色を適用
      const typeElement =
        div.querySelector(".next-train-type");

      applyTrainTypeStyle(
        typeElement,
        train.type || "普通"
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
        trains
          .map(t => t.route)
          .filter(Boolean)
      )];

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

  loadData();

})();

/* MEITETSU Operation Web - train-linked edition */
(() => {
  "use strict";

  const DATA_URL = "./data/timetables.json";
  const OFFICIAL_URL = "https://www.meitetsu.co.jp/train/timetable/";

  const CREW_BY_ROUTE = [
    {
      keys: [
        "名古屋本線",
        "豊川線",
        "津島線",
        "尾西線",
        "竹鼻線",
        "羽島線"
      ],
      crew: "名古屋乗務区"
    },
    {
      keys: [
        "常滑線",
        "空港線",
        "河和線",
        "知多新線"
      ],
      crew: "神宮前乗務区"
    },
    {
      keys: [
        "犬山線",
        "各務原線",
        "広見線",
        "小牧線"
      ],
      crew: "犬山乗務区"
    },
    {
      keys: [
        "三河線",
        "豊田線",
        "西尾線",
        "蒲郡線"
      ],
      crew: "知立乗務区"
    },
    {
      keys: ["瀬戸線"],
      crew: "瀬戸運輸区"
    }
  ];

  const TYPE_ICON = {
    "ミュースカイ": "μS",
    "快速特急": "快特",
    "特急": "特急",
    "快速急行": "快急",
    "急行": "急行",
    "準急": "準急",
    "普通": "普通"
  };

  const $ = id => document.getElementById(id);

  let trains = [];
  let selected = null;
  let selectedStation = "";

  let favorites = JSON.parse(
    localStorage.getItem("meitetsuFav") || "[]"
  );

  function norm(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[‐-–—−]/g, "-")
      .toUpperCase();
  }

  function typeName(value) {
    const s = String(value ?? "").trim();

    if (
      s.includes("ミュースカイ") ||
      s === "μS" ||
      s.toLowerCase() === "μsky"
    ) {
      return "ミュースカイ";
    }

    if (s.includes("快速特急") || s === "快特") {
      return "快速特急";
    }

    if (s === "特急" || s.includes("特急")) {
      return "特急";
    }

    if (s.includes("快速急行") || s === "快急") {
      return "快速急行";
    }

    if (s === "急行" || s.includes("急行")) {
      return "急行";
    }

    if (s === "準急" || s.includes("準急")) {
      return "準急";
    }

    if (s === "普通") {
      return "普通";
    }

    return s || "普通";
  }

  function crewFor(route) {
    const r = String(route || "");

    for (const item of CREW_BY_ROUTE) {
      if (item.keys.some(key => r.includes(key))) {
        return item.crew;
      }
    }

    return "名古屋乗務区";
  }

  function routeLabel(train) {
    return (
      train.route ||
      train.line ||
      train.lineName ||
      "名鉄線"
    );
  }

  function stationsOf(train) {
    if (
      Array.isArray(train.stops) &&
      train.stops.length
    ) {
      return train.stops.map(stop =>
        typeof stop === "string"
          ? {
              station: stop,
              time: ""
            }
          : stop
      );
    }

    const stations = train.stations || [];
    const times = train.times || [];

    return stations
      .map((station, index) => ({
        station:
          typeof station === "string"
            ? station
            : station.station ||
              station.name ||
              "",
        time: times[index] || ""
      }))
      .filter(item => item.station);
  }

  function getTrainNumber(train) {
    return (
      train.trainNumber ??
      train.number ??
      train.no ??
      train.train_no ??
      train.id
    );
  }

  function prepare(raw) {
    const array = Array.isArray(raw)
      ? raw
      : (
          raw.trains ||
          raw.data ||
          raw.items ||
          []
        );

    return array
      .map((train, index) => {
        const stops = stationsOf(train);
        const route = routeLabel(train);
        const type = typeName(
          train.type ||
          train.trainType ||
          train.kind
        );

        const number = String(
          getTrainNumber(train) ?? ""
        ).trim();

        let origin =
          train.origin ||
          train.from ||
          "";

        let destination =
          train.destination ||
          train.to ||
          "";

        if (!origin && stops.length) {
          origin = stops[0].station;
        }

        if (!destination && stops.length) {
          destination =
            stops[stops.length - 1].station;
        }

        return {
          ...train,

          id:
            train.id ||
            `${norm(number)}-${index}`,

          trainNumber: number,
          type,
          route,
          origin,
          destination,
          stops,

          crew:
            train.crew ||
            crewFor(route)
        };
      })
      .filter(train => train.trainNumber);
  }

  async function loadData() {
    const status = $("dataStatus");

    try {
      const response = await fetch(
        `${DATA_URL}?v=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const json = await response.json();

      trains = prepare(json);

      if (status) {
        status.textContent =
          `公式時刻表データ：${trains.length.toLocaleString()}列車`;
      }

      populateLines();
      renderNextTrains();
      renderTimetable();

      const initial =
        trains.find(
          train =>
            norm(train.trainNumber) === "299"
        ) ||
        trains[0];

      if (initial) {
        selectTrain(initial, false);
      }

    } catch (error) {
      console.error(error);

      if (status) {
        status.textContent =
          "時刻表データを読み込めませんでした。GitHub Pagesのdata/timetables.jsonを確認してください。";
      }
    }
  }

  function populateLines() {
    const line = $("lineSelect");

    if (!line) return;

    const routes = [
      ...new Set(
        trains
          .map(train => routeLabel(train))
          .filter(Boolean)
      )
    ].sort();

    line.innerHTML =
      `<option value="">すべての路線</option>` +
      routes
        .map(route =>
          `<option>${esc(route)}</option>`
        )
        .join("");

    line.onchange = () => {
      const station = $("stationSelect");

      const list = trains
        .filter(
          train =>
            !line.value ||
            routeLabel(train) === line.value
        )
        .flatMap(stationsOf);

      const stations = [
        ...new Set(
          list
            .map(item => item.station)
            .filter(Boolean)
        )
      ];

      if (station) {
        station.innerHTML =
          `<option value="">すべての駅</option>` +
          stations
            .map(
              name =>
                `<option>${esc(name)}</option>`
            )
            .join("");
      }

      renderNextTrains();
    };
  }

  function searchTrain() {
    const input = $("trainNumberInput");

    const query = norm(
      input?.value
    );

    if (!query) return;

    const found =
      trains.find(
        train =>
          norm(train.trainNumber) === query
      ) ||
      trains.find(
        train =>
          norm(train.trainNumber)
            .startsWith(query)
      );

    const result =
      $("trainSearchResult");

    if (!found) {
      if (result) {
        result.innerHTML =
          `<div class="search-empty">
            列車番号「${esc(query)}」が見つかりませんでした。
          </div>`;
      }

      return;
    }

    if (result) {
      result.innerHTML =
        `<button class="found-train"
          data-id="${esc(found.id)}">
          <b>${esc(found.trainNumber)}</b>
          ${esc(found.type)}
          ${esc(found.origin)}
          →
          ${esc(found.destination)}
          <small>${esc(found.crew)}</small>
        </button>`;
    }

    selectTrain(found, true);
  }

  function selectTrain(train, detail = true) {
    selected = train;
    selectedStation = "";

    fillMain(train);
    fillDetail(train);

    if (detail) {
      $("detailView")?.removeAttribute(
        "hidden"
      );

      $("listView")?.setAttribute(
        "hidden",
        ""
      );

      window.scrollTo(0, 0);
    }
  }

  function fillMain(train) {
    const type = typeName(train.type);

    setText("trainType", type);

    setText(
      "serviceCode",
      TYPE_ICON[type] || type
    );

    setText(
      "trainNo",
      train.trainNumber
    );

    setText(
      "origin",
      train.origin || "—"
    );

    setText(
      "destination",
      train.destination || "—"
    );

    setText(
      "metricLine",
      routeLabel(train)
    );

    setText(
      "metricPosition",
      train.origin || "—"
    );

    setText(
      "detailCrewName",
      train.crew ||
        crewFor(train.route)
    );

    setText(
      "detailType",
      type
    );

    setText(
      "detailCode",
      TYPE_ICON[type] || type
    );

    setText(
      "detailTrainNo",
      train.trainNumber
    );

    setText(
      "detailOrigin",
      train.origin || "—"
    );

    setText(
      "detailDestination",
      train.destination || "—"
    );

    setText(
      "detailCrewState",
      "乗務中"
    );

    setText(
      "cars",
      train.cars
        ? `${train.cars}両`
        : type === "ミュースカイ"
          ? "8両"
          : "—"
    );

    setText(
      "detailCars",
      train.cars || "—"
    );

    const stops =
      stationsOf(train);

    renderSchedule(stops);
    renderRouteMap(stops);
    renderTimetable();

    setText(
      "heroSub",
      `${train.trainNumber}　${type}　${train.origin || ""} → ${train.destination || ""}`
    );
  }

  function fillDetail(train) {
    const rows =
      $("detailSchedule");

    if (!rows) return;

    const stops =
      stationsOf(train);

    rows.innerHTML =
      stops
        .map(
          (stop, index) => `
            <tr>
              <td>
                ${
                  index === 0
                    ? "始"
                    : index === stops.length - 1
                      ? "終"
                      : "・"
                }
              </td>
              <td>${esc(stop.station)}</td>
              <td>
                ${esc(
                  stop.arrival ||
                  stop.time ||
                  "—"
                )}
              </td>
              <td>
                ${esc(
                  stop.departure ||
                  stop.time ||
                  "—"
                )}
              </td>
            </tr>
          `
        )
        .join("");

    setText(
      "detailNotice",
      `${routeLabel(train)} / ${train.trainNumber} / ${train.type}`
    );
  }

  function renderSchedule(stops) {
    const body =
      $("scheduleTable")
        ?.querySelector("tbody");

    if (!body) return;

    body.innerHTML =
      stops
        .map(
          (stop, index) => {
            const time =
              stop.time ||
              stop.departure ||
              stop.arrival ||
              "—";

            return `
              <tr>
                <td>${esc(stop.station)}</td>
                <td>${esc(stop.arrival || time)}</td>
                <td>${esc(stop.departure || time)}</td>
                <td>
                  ${
                    index === 0
                      ? "始発"
                      : index === stops.length - 1
                        ? "終着"
                        : "停車"
                  }
                </td>
                <td>
                  <button
                    class="mini-btn"
                    data-station="${esc(stop.station)}">
                    表示
                  </button>
                </td>
              </tr>
            `;
          }
        )
        .join("");

    body
      .querySelectorAll("[data-station]")
      .forEach(button => {
        button.onclick = () => {
          selectedStation =
            button.dataset.station;

          setText(
            "metricStation",
            selectedStation
          );

          setText(
            "metricPosition",
            selectedStation
          );
        };
      });
  }

  function renderRouteMap(stops) {
    const map =
      $("routeMap");

    if (!map) return;

    map.innerHTML =
      stops
        .map(
          (stop, index) => `
            <div class="route-node ${
              index === 0
                ? "passed"
                : ""
            }">
              <span class="node-dot"></span>
              <b>${esc(stop.station)}</b>
              <small>
                ${esc(
                  stop.time ||
                  stop.departure ||
                  ""
                )}
              </small>
            </div>
          `
        )
        .join("");
  }

  function renderNextTrains() {
    const line =
      $("lineSelect")?.value || "";

    const type =
      $("typeSelect")?.value || "";

    let list =
      trains.filter(
        train =>
          (!line ||
            routeLabel(train) === line) &&
          (!type ||
            typeName(train.type) === type)
      );

    list =
      list.slice(0, 8);

    const box =
      $("nextTrains");

    if (box) {
      box.innerHTML =
        list
          .map(
            train => `
              <button
                class="next-train-item"
                data-train="${esc(train.id)}">
                <b>${esc(train.trainNumber)}</b>
                <span>${esc(train.type)}</span>
                <small>
                  ${esc(train.destination || "")}
                </small>
              </button>
            `
          )
          .join("");
    }

    box
      ?.querySelectorAll("[data-train]")
      .forEach(button => {
        button.onclick = () => {
          const train =
            trains.find(
              item =>
                item.id ===
                button.dataset.train
            );

          if (train) {
            selectTrain(train, true);
          }
        };
      });
  }

  function renderTimetable() {
    const box =
      $("timetableList");

    if (!box) return;

    const station =
      $("stationSelect")?.value ||
      selectedStation;

    if (!station) {
      box.innerHTML =
        `<div class="empty-state">
          列車を選択すると停車駅・時刻を表示します。
        </div>`;

      return;
    }

    const rows = [];

    for (const train of trains) {
      const stop =
        stationsOf(train)
          .find(
            item =>
              item.station === station
          );

      if (stop) {
        rows.push({
          train,
          stop
        });
      }
    }

    box.innerHTML =
      rows
        .slice(0, 20)
        .map(
          item => `
            <button
              class="next-train-item"
              data-train="${esc(item.train.id)}">
              <b>
                ${esc(
                  item.stop.time ||
                  item.stop.departure ||
                  "—"
                )}
              </b>
              <span>
                ${esc(item.train.type)}
              </span>
              <small>
                ${esc(item.train.trainNumber)}
                →
                ${esc(item.train.destination)}
              </small>
            </button>
          `
        )
        .join("");

    box
      .querySelectorAll("[data-train]")
      .forEach(button => {
        button.onclick = () => {
          const train =
            trains.find(
              item =>
                item.id ===
                button.dataset.train
            );

          if (train) {
            selectTrain(train, true);
          }
        };
      });
  }

  function updateClock() {
    const date =
      new Date();

    const time =
      date.toLocaleTimeString(
        "ja-JP",
        {
          hour12: false
        }
      );

    const dateText =
      date.toLocaleDateString(
        "ja-JP",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          weekday: "short"
        }
      );

    setText(
      "digital",
      time
    );

    setText(
      "detailDigital",
      time
    );

    setText(
      "dateText",
      dateText
    );

    setText(
      "detailDate",
      dateText
    );

    drawClock(
      "analog",
      date,
      190
    );

    drawClock(
      "detailAnalog",
      date,
      220
    );

    if (selected) {
      updateLive(
        selected,
        date
      );
    }
  }

  function updateLive(train, date) {
    const stops =
      stationsOf(train);

    if (!stops.length) return;

    const minutes =
      date.getHours() * 60 +
      date.getMinutes() +
      date.getSeconds() / 60;

    let index = 0;

    for (
      let i = 0;
      i < stops.length;
      i++
    ) {
      const value =
        parseTime(
          stops[i].time ||
          stops[i].departure ||
          stops[i].arrival
        );

      if (
        value !== null &&
        value <= minutes
      ) {
        index = i;
      }
    }

    const current =
      stops[index];

    const next =
      stops[
        Math.min(
          index + 1,
          stops.length - 1
        )
      ];

    setText(
      "currentLocation",
      `現在位置：${current.station}`
    );

    setText(
      "nextStop",
      `次駅：${next.station}`
    );

    const nextMinutes =
      parseTime(
        next.time ||
        next.departure ||
        next.arrival
      );

    const difference =
      nextMinutes === null
        ? null
        : Math.max(
            0,
            Math.round(
              nextMinutes - minutes
            )
          );

    setText(
      "eta",
      `到着まで ${
        difference === null
          ? "—"
          : difference + "分"
      }`
    );

    setText(
      "metricStation",
      current.station
    );

    setText(
      "metricNext",
      next.time ||
        next.departure ||
        "--:--"
    );

    setText(
      "metricCountdown",
      difference === null
        ? "—"
        : `${difference}分後`
    );

    setText(
      "positionUpdated",
      `更新 ${date.toLocaleTimeString(
        "ja-JP",
        { hour12: false }
      )}`
    );
  }

  function parseTime(value) {
    if (!value) return null;

    const text =
      String(value)
        .replace(/[^\d:]/g, "");

    let hour;
    let minute;

    if (text.includes(":")) {
      [hour, minute] =
        text
          .split(":")
          .map(Number);
    } else if (
      text.length >= 3
    ) {
      hour =
        Number(
          text.slice(0, -2)
        );

      minute =
        Number(
          text.slice(-2)
        );
    } else {
      return null;
    }

    if (hour >= 24) {
      hour %= 24;
    }

    return (
      hour * 60 +
      minute
    );
  }

  function drawClock(id, date, size) {
    const canvas = $(id);

    if (!canvas) return;

    const ctx =
      canvas.getContext("2d");

    const radius =
      size / 2;

    ctx.clearRect(
      0,
      0,
      size,
      size
    );

    ctx.beginPath();

    ctx.arc(
      radius,
      radius,
      radius - 5,
      0,
      Math.PI * 2
    );

    ctx.stroke();

    for (
      let i = 0;
      i < 12;
      i++
    ) {
      const angle =
        i * Math.PI / 6 -
        Math.PI / 2;

      ctx.beginPath();

      ctx.moveTo(
        radius +
          Math.cos(angle) *
            (radius - 15),
        radius +
          Math.sin(angle) *
            (radius - 15)
      );

      ctx.lineTo(
        radius +
          Math.cos(angle) *
            (radius - 7),
        radius +
          Math.sin(angle) *
            (radius - 7)
      );

      ctx.stroke();
    }

    const seconds =
      date.getSeconds();

    const minutes =
      date.getMinutes();

    const hours =
      date.getHours() % 12 +
      minutes / 60;

    hand(
      ctx,
      radius,
      hours * Math.PI / 6,
      radius * 0.45,
      3
    );

    hand(
      ctx,
      radius,
      minutes * Math.PI / 30,
      radius * 0.62,
      2
    );

    hand(
      ctx,
      radius,
      seconds * Math.PI / 30,
      radius * 0.72,
      1
    );
  }

  function hand(
    ctx,
    radius,
    angle,
    length,
    width
  ) {
    ctx.beginPath();

    ctx.lineWidth =
      width;

    ctx.moveTo(
      radius,
      radius
    );

    ctx.lineTo(
      radius +
        Math.sin(angle) *
          length,
      radius -
        Math.cos(angle) *
          length
    );

    ctx.stroke();
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent =
        value;
    }
  }

  function esc(value) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char])
    );
  }

  function init() {
    $("trainSearchBtn")
      ?.addEventListener(
        "click",
        searchTrain
      );

    $("trainNumberInput")
      ?.addEventListener(
        "keydown",
        event => {
          if (
            event.key === "Enter"
          ) {
            searchTrain();
          }
        }
      );

    $("typeSelect")
      ?.addEventListener(
        "change",
        renderNextTrains
      );

    $("stationSelect")
      ?.addEventListener(
        "change",
        renderTimetable
      );

    $("detailBack")
      ?.addEventListener(
        "click",
        () => {
          $("detailView")
            ?.setAttribute(
              "hidden",
              ""
            );

          $("listView")
            ?.removeAttribute(
              "hidden"
            );
        }
      );

    $("backBtn")
      ?.addEventListener(
        "click",
        () => {
          $("detailView")
            ?.setAttribute(
              "hidden",
              ""
            );

          $("listView")
            ?.removeAttribute(
              "hidden"
            );
        }
      );

    $("refreshBtn")
      ?.addEventListener(
        "click",
        loadData
      );

    $("officialBtn")
      ?.addEventListener(
        "click",
        () =>
          window.open(
            OFFICIAL_URL,
            "_blank"
          )
      );

    $("officialMenu")
      ?.addEventListener(
        "click",
        () =>
          window.open(
            OFFICIAL_URL,
            "_blank"
          )
      );

    $("darkToggle")
      ?.addEventListener(
        "change",
        event =>
          document.body.classList.toggle(
            "dark",
            event.target.checked
          )
      );

    $("themeBtn")
      ?.addEventListener(
        "click",
        () =>
          document.body.classList.toggle(
            "dark"
          )
      );

    $("detailTheme")
      ?.addEventListener(
        "click",
        () =>
          document.body.classList.toggle(
            "dark"
          )
      );

    $("zoomIn")
      ?.addEventListener(
        "click",
        () =>
          document.documentElement.style.fontSize =
            "112%"
      );

    $("zoomOut")
      ?.addEventListener(
        "click",
        () =>
          document.documentElement.style.fontSize =
            "96%"
      );

    $("detailZoomIn")
      ?.addEventListener(
        "click",
        () =>
          document.documentElement.style.fontSize =
            "112%"
      );

    $("detailZoomOut")
      ?.addEventListener(
        "click",
        () =>
          document.documentElement.style.fontSize =
            "96%"
      );

    setInterval(
      updateClock,
      1000
    );

    updateClock();
    loadData();
  }

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

  window.MeitetsuApp = {
    get trains() {
      return trains;
    },

    selectTrain
  };
})();

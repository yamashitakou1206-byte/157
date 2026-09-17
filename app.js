"use strict";

/* =========================================================
   MEITETSU Operation Web v6.3
   GitHub Pages / data/timetables.json 対応版
   ========================================================= */

const DATA_URL = "./data/timetables.json";

let timetableData = [];
let trainIndex = new Map();
let currentTrain = null;
let favorites = JSON.parse(localStorage.getItem("meitetsuFavorites") || "[]");

/* ---------------------------------------------------------
   基本ユーティリティ
--------------------------------------------------------- */

function $(id) {
  return document.getElementById(id);
}

function normalizeTrainNumber(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nowTime() {
  return new Date().toLocaleTimeString("ja-JP", {
    hour12: false
  });
}

/* ---------------------------------------------------------
   データ読み込み
--------------------------------------------------------- */

async function loadTimetableData() {
  const status = $("dataStatus");

  if (status) {
    status.textContent = "時刻表データを読み込んでいます…";
    status.className = "data-status";
  }

  try {
    console.log("[MEITETSU] JSON loading:", DATA_URL);

    const response = await fetch(DATA_URL + "?v=" + Date.now(), {
      cache: "no-store"
    });

    console.log("[MEITETSU] HTTP status:", response.status);

    if (!response.ok) {
      throw new Error(
        "時刻表データを取得できませんでした HTTP " +
        response.status
      );
    }

    const json = await response.json();

    console.log("[MEITETSU] JSON loaded:", json);

    /*
      現在の生成形式:
      {
        version,
        updatedAt,
        source,
        trainCount,
        trains: [...]
      }
    */

    if (Array.isArray(json)) {
      timetableData = json;
    } else if (Array.isArray(json.trains)) {
      timetableData = json.trains;
    } else if (Array.isArray(json.data)) {
      timetableData = json.data;
    } else {
      throw new Error("JSON内に列車データがありません");
    }

    buildTrainIndex();

    if (status) {
      status.textContent =
        "✓ 時刻表データ読込完了（" +
        timetableData.length.toLocaleString() +
        "件）";

      status.className = "data-status loaded";
    }

    console.log(
      "[MEITETSU] trains:",
      timetableData.length
    );

    return true;

  } catch (error) {

    console.error(
      "[MEITETSU] timetable load error:",
      error
    );

    if (status) {
      status.textContent =
        "⚠ 時刻表データを読み込めませんでした：" +
        error.message;

      status.className = "data-status error";
    }

    /*
      データが読めなくてもアプリ本体は使用可能にする
    */
    timetableData = [];
    trainIndex.clear();

    return false;
  }
}

/* ---------------------------------------------------------
   列車番号インデックス
--------------------------------------------------------- */

function buildTrainIndex() {

  trainIndex.clear();

  for (const train of timetableData) {

    const raw =
      train.trainNumber ??
      train.number ??
      train.id ??
      "";

    const number = normalizeTrainNumber(raw);

    if (!number) continue;

    if (!trainIndex.has(number)) {
      trainIndex.set(number, []);
    }

    trainIndex.get(number).push(train);

    /*
      数字部分だけでも検索可能にする
      例:
      1980S → 1980
    */

    const numeric = number.replace(/[^0-9]/g, "");

    if (numeric && numeric !== number) {

      if (!trainIndex.has(numeric)) {
        trainIndex.set(numeric, []);
      }

      trainIndex.get(numeric).push(train);
    }
  }

  console.log(
    "[MEITETSU] train index:",
    trainIndex.size
  );
}

/* ---------------------------------------------------------
   列車番号検索
--------------------------------------------------------- */

function searchTrainNumber(value) {

  const query = normalizeTrainNumber(value);

  if (!query) return [];

  const direct = trainIndex.get(query);

  if (direct && direct.length) {
    return direct;
  }

  const result = [];

  for (const train of timetableData) {

    const number = normalizeTrainNumber(
      train.trainNumber ??
      train.number ??
      train.id ??
      ""
    );

    if (
      number === query ||
      number.includes(query)
    ) {
      result.push(train);
    }
  }

  return result;
}

/* ---------------------------------------------------------
   検索結果表示
--------------------------------------------------------- */

function showTrainSearchResult(results, query) {

  const box = $("trainSearchResult");

  if (!box) return;

  if (!query) {
    box.innerHTML = "";
    return;
  }

  if (!results.length) {

    box.innerHTML = `
      <div class="search-empty">
        「${escapeHTML(query)}」に該当する列車が見つかりませんでした。
      </div>
    `;

    return;
  }

  /*
    大量データがあるため最大20件まで表示
  */

  const list = results.slice(0, 20);

  box.innerHTML = `
    <div class="search-result-title">
      列車番号検索結果（${results.length}件）
    </div>

    ${list.map((train, index) => {

      const number =
        train.trainNumber ??
        train.number ??
        train.id ??
        "—";

      const type =
        train.type ??
        "列車";

      return `
        <button
          class="train-result-item"
          data-index="${index}"
        >
          <strong>${escapeHTML(number)}</strong>
          <span>${escapeHTML(type)}</span>
        </button>
      `;

    }).join("")}
  `;

  box.querySelectorAll(
    ".train-result-item"
  ).forEach(button => {

    button.addEventListener("click", () => {

      const index =
        Number(button.dataset.index);

      openTrainDetail(list[index]);
    });

  });
}

/* ---------------------------------------------------------
   列車詳細
--------------------------------------------------------- */

function openTrainDetail(train) {

  if (!train) return;

  currentTrain = train;

  console.log(
    "[MEITETSU] selected train:",
    train
  );

  const number =
    train.trainNumber ??
    train.number ??
    train.id ??
    "—";

  const type =
    train.type ??
    "普通";

  const origin =
    train.origin ??
    getFirstStation(train) ??
    "—";

  const destination =
    train.destination ??
    getLastStation(train) ??
    "—";

  setText("trainNo", number);
  setText("detailTrainNo", number);

  setText("trainType", type);
  setText("detailType", type);

  setText("origin", origin);
  setText("detailOrigin", origin);

  setText("destination", destination);
  setText("detailDestination", destination);

  renderSchedule(train);
  renderRouteMap(train);

  /*
    一覧画面から詳細画面へ
  */

  $("listView").hidden = true;
  $("detailView").hidden = false;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* ---------------------------------------------------------
   駅データ取得
--------------------------------------------------------- */

function getStops(train) {

  if (Array.isArray(train.stops)) {
    return train.stops;
  }

  if (Array.isArray(train.stations)) {
    return train.stations;
  }

  if (Array.isArray(train.schedule)) {
    return train.schedule;
  }

  return [];
}

function getFirstStation(train) {

  const stops = getStops(train);

  if (!stops.length) return null;

  const first = stops[0];

  return typeof first === "string"
    ? first
    : first.station ??
      first.name ??
      first.st ??
      null;
}

function getLastStation(train) {

  const stops = getStops(train);

  if (!stops.length) return null;

  const last = stops[stops.length - 1];

  return typeof last === "string"
    ? last
    : last.station ??
      last.name ??
      last.st ??
      null;
}

/* ---------------------------------------------------------
   時刻取得
--------------------------------------------------------- */

function getTimeAt(train, index) {

  const times =
    train.times ??
    train.stopTimes ??
    [];

  if (!Array.isArray(times)) {
    return "—";
  }

  return times[index] ?? "—";
}

/* ---------------------------------------------------------
   詳細時刻表
--------------------------------------------------------- */

function renderSchedule(train) {

  const body = $("detailSchedule");

  if (!body) return;

  const stops = getStops(train);

  if (!stops.length) {

    body.innerHTML = `
      <tr>
        <td colspan="4">
          駅・時刻データを確認できません。
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = stops
    .slice(0, 150)
    .map((stop, index) => {

      const name =
        typeof stop === "string"
          ? stop
          : stop.station ??
            stop.name ??
            stop.st ??
            "—";

      const time = getTimeAt(train, index);

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHTML(name)}</td>
          <td>${escapeHTML(time)}</td>
          <td>${escapeHTML(time)}</td>
        </tr>
      `;

    })
    .join("");
}

/* ---------------------------------------------------------
   メイン画面の時刻表
--------------------------------------------------------- */

function renderMainSchedule(train) {

  const body =
    $("scheduleTable")?.querySelector("tbody");

  if (!body) return;

  const stops = getStops(train);

  body.innerHTML = stops
    .slice(0, 100)
    .map((stop, index) => {

      const name =
        typeof stop === "string"
          ? stop
          : stop.station ??
            stop.name ??
            "—";

      const time = getTimeAt(train, index);

      return `
        <tr>
          <td>${escapeHTML(name)}</td>
          <td>${escapeHTML(time)}</td>
          <td>${escapeHTML(time)}</td>
          <td>予定</td>
          <td></td>
        </tr>
      `;

    })
    .join("");
}

/* ---------------------------------------------------------
   走行位置
--------------------------------------------------------- */

function renderRouteMap(train) {

  const map = $("routeMap");

  if (!map) return;

  const stops = getStops(train);

  if (!stops.length) {

    map.innerHTML = `
      <div class="route-empty">
        駅情報を確認中…
      </div>
    `;

    return;
  }

  map.innerHTML = stops
    .slice(0, 80)
    .map((stop, index) => {

      const name =
        typeof stop === "string"
          ? stop
          : stop.station ??
            stop.name ??
            "—";

      return `
        <div class="route-stop ${index === 0 ? "current" : ""}">
          <span class="route-dot"></span>
          <span>${escapeHTML(name)}</span>
        </div>
      `;

    })
    .join("");
}

/* ---------------------------------------------------------
   画面テキスト
--------------------------------------------------------- */

function setText(id, value) {

  const el = $(id);

  if (el) {
    el.textContent = value ?? "—";
  }
}

/* ---------------------------------------------------------
   時計
--------------------------------------------------------- */

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

  setText("digital", time);
  setText("detailDigital", time);
  setText("dateText", date);
  setText("detailDate", date);
  setText("lastUpdated", "更新 " + time);
  setText("positionUpdated", "更新 " + time);
}

/* ---------------------------------------------------------
   戻る
--------------------------------------------------------- */

function backToList() {

  $("detailView").hidden = true;
  $("listView").hidden = false;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* ---------------------------------------------------------
   お気に入り
--------------------------------------------------------- */

function saveFavoriteStation() {

  const station =
    $("metricStation")?.textContent;

  if (!station || station === "—") {
    return;
  }

  if (!favorites.includes(station)) {
    favorites.push(station);
  }

  localStorage.setItem(
    "meitetsuFavorites",
    JSON.stringify(favorites)
  );

  renderFavorites();
}

function renderFavorites() {

  const box = $("favoritesList");

  if (!box) return;

  if (!favorites.length) {

    box.innerHTML =
      "<small>お気に入り駅はありません</small>";

  } else {

    box.innerHTML = favorites
      .map(name => `
        <div class="favorite-item">
          ★ ${escapeHTML(name)}
        </div>
      `)
      .join("");
  }

  setText(
    "metricFav",
    favorites.length
  );
}

/* ---------------------------------------------------------
   イベント設定
--------------------------------------------------------- */

function setupEvents() {

  /*
    列車番号検索
  */

  $("trainSearchBtn")?.addEventListener(
    "click",
    () => {

      const input =
        $("trainNumberInput");

      const query =
        input?.value.trim() || "";

      const results =
        searchTrainNumber(query);

      showTrainSearchResult(
        results,
        query
      );

      /*
        完全一致が1件なら即詳細へ
      */

      if (results.length === 1) {
        openTrainDetail(results[0]);
      }
    }
  );

  $("trainNumberInput")?.addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {
        $("trainSearchBtn")?.click();
      }

    }
  );

  /*
    戻る
  */

  $("backBtn")?.addEventListener(
    "click",
    backToList
  );

  $("detailBack")?.addEventListener(
    "click",
    backToList
  );

  /*
    更新
  */

  $("refreshBtn")?.addEventListener(
    "click",
    async () => {

      await loadTimetableData();
      updateClock();
    }
  );

  /*
    お気に入り
  */

  $("favoriteStation")?.addEventListener(
    "click",
    saveFavoriteStation
  );

  $("clearFavorites")?.addEventListener(
    "click",
    () => {

      favorites = [];

      localStorage.setItem(
        "meitetsuFavorites",
        "[]"
      );

      renderFavorites();
    }
  );

  /*
    ダークモード
  */

  $("darkToggle")?.addEventListener(
    "change",
    event => {
      document.body.classList.toggle(
        "light-mode",
        !event.target.checked
      );
    }
  );

  $("themeBtn")?.addEventListener(
    "click",
    () => {
      document.body.classList.toggle(
        "light-mode"
      );
    }
  );

  $("detailTheme")?.addEventListener(
    "click",
    () => {
      document.body.classList.toggle(
        "light-mode"
      );
    }
  );

  /*
    ズーム
  */

  let zoom = 1;

  function changeZoom(amount) {

    zoom = Math.max(
      0.85,
      Math.min(1.2, zoom + amount)
    );

    document.documentElement.style.fontSize =
      (16 * zoom) + "px";
  }

  $("zoomIn")?.addEventListener(
    "click",
    () => changeZoom(0.05)
  );

  $("zoomOut")?.addEventListener(
    "click",
    () => changeZoom(-0.05)
  );

  $("detailZoomIn")?.addEventListener(
    "click",
    () => changeZoom(0.05)
  );

  $("detailZoomOut")?.addEventListener(
    "click",
    () => changeZoom(-0.05)
  );

  /*
    公式運行情報
  */

  $("officialBtn")?.addEventListener(
    "click",
    () => {
      window.open(
        "https://www.meitetsu.co.jp/em/",
        "_blank"
      );
    }
  );

  $("officialMenu")?.addEventListener(
    "click",
    () => {
      window.open(
        "https://www.meitetsu.co.jp/em/",
        "_blank"
      );
    }
  );

  /*
    フルスクリーン
  */

  $("fullscreenBtn")?.addEventListener(
    "click",
    async () => {

      try {

        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }

      } catch (e) {
        console.warn(e);
      }

    }
  );
}

/* ---------------------------------------------------------
   初期化
--------------------------------------------------------- */

async function init() {

  console.log(
    "[MEITETSU] Application starting..."
  );

  updateClock();
  renderFavorites();
  setupEvents();

  /*
    ここが重要。
    JSONの読み込みに失敗しても
    アプリ自体は止めない。
  */

  await loadTimetableData();

  updateClock();

  console.log(
    "[MEITETSU] Application ready."
  );
}

/* ---------------------------------------------------------
   定期時計更新
--------------------------------------------------------- */

setInterval(
  updateClock,
  1000
);

/* ---------------------------------------------------------
   START
--------------------------------------------------------- */

if (
  document.readyState === "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

} else {

  init();

}

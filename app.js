/* MEITETSU Operation Web - train-linked edition */
(() => {
  "use strict";

  const DATA_URL = "./data/timetables.json";
  const OFFICIAL_URL = "https://www.meitetsu.co.jp/train/timetable/";

  const CREW_BY_ROUTE = [
    { keys:["名古屋本線","豊川線","津島線","尾西線","竹鼻線","羽島線"], crew:"名古屋乗務区" },
    { keys:["常滑線","空港線","河和線","知多新線"], crew:"神宮前乗務区" },
    { keys:["犬山線","各務原線","広見線","小牧線"], crew:"犬山乗務区" },
    { keys:["三河線","豊田線","西尾線","蒲郡線"], crew:"知立乗務区" },
    { keys:["瀬戸線"], crew:"瀬戸運輸区" }
  ];

  const TYPE_ICON = {
    "ミュースカイ":"μS","快速特急":"快特","特急":"特急",
    "快速急行":"快急","急行":"急行","準急":"準急","普通":"普通"
  };

  const $ = id => document.getElementById(id);
  let trains = [];
  let selected = null;
  let selectedStation = "";
  let favorites = JSON.parse(localStorage.getItem("meitetsuFav") || "[]");

  function norm(v) {
    return String(v ?? "").trim().replace(/\s+/g,"").replace(/[‐‑–—−]/g,"-").toUpperCase();
  }

  function typeName(v) {
    const s = String(v ?? "").trim();
    if (s.includes("ミュースカイ") || s === "μS" || s.toLowerCase() === "μsky") return "ミュースカイ";
    if (s.includes("快速特急") || s === "快特") return "快速特急";
    if (s === "特急" || s.includes("特急")) return "特急";
    if (s.includes("快速急行") || s === "快急") return "快速急行";
    if (s === "急行" || s.includes("急行")) return "急行";
    if (s === "準急" || s.includes("準急")) return "準急";
    if (s === "普通") return "普通";
    return s || "普通";
  }

  function crewFor(route) {
    const r = String(route || "");
    for (const x of CREW_BY_ROUTE) if (x.keys.some(k => r.includes(k))) return x.crew;
    return "名古屋乗務区";
  }

  function routeLabel(t) {
    return t.route || t.line || t.lineName || "名鉄線";
  }

  function stationsOf(t) {
    if (Array.isArray(t.stops) && t.stops.length) {
      return t.stops.map(s => typeof s === "string" ? ({station:s,time:""}) : s);
    }
    const ss = t.stations || [];
    const ts = t.times || [];
    return ss.map((s,i) => ({station: typeof s === "string" ? s : (s.station || s.name || ""), time: ts[i] || ""}))
      .filter(x => x.station);
  }

  function getTrainNumber(t) {
    return t.trainNumber ?? t.number ?? t.no ?? t.train_no ?? t.id;
  }

  function prepare(raw) {
    const arr = Array.isArray(raw) ? raw : (raw.trains || raw.data || raw.items || []);
    return arr.map((t,i) => {
      const stops = stationsOf(t);
      const route = routeLabel(t);
      const type = typeName(t.type || t.trainType || t.kind);
      const no = String(getTrainNumber(t) ?? "").trim();
      let origin = t.origin || t.from || "";
      let destination = t.destination || t.to || "";
      if (!origin && stops.length) origin = stops[0].station;
      if (!destination && stops.length) destination = stops[stops.length-1].station;
      return {
        ...t, id: t.id || `${norm(no)}-${i}`, trainNumber:no, type, route,
        origin, destination, stops, crew: t.crew || crewFor(route)
      };
    }).filter(t => t.trainNumber);
  }

  async function loadData() {
    const status = $("dataStatus");
    try {
      const res = await fetch(`${DATA_URL}?v=${Date.now()}`, {cache:"no-store"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      trains = prepare(json);
      if (status) status.textContent = `公式時刻表データ：${trains.length.toLocaleString()}列車`;
      populateLines();
      renderNextTrains();
      renderTimetable();
      const initial = trains.find(t => norm(t.trainNumber) === "299") || trains[0];
      if (initial) selectTrain(initial, false);
    } catch (e) {
      console.error(e);
      if (status) status.textContent = "時刻表データを読み込めませんでした。GitHub Pagesのdata/timetables.jsonを確認してください。";
    }
  }

  function populateLines() {
    const line = $("lineSelect");
    if (!line) return;
    const routes = [...new Set(trains.map(t => routeLabel(t)).filter(Boolean))].sort();
    line.innerHTML = `<option value="">すべての路線</option>` + routes.map(x=>`<option>${esc(x)}</option>`).join("");
    line.onchange = () => {
      const station = $("stationSelect");
      const list = trains.filter(t => !line.value || routeLabel(t) === line.value).flatMap(stationsOf);
      const ss = [...new Set(list.map(x=>x.station).filter(Boolean))];
      if (station) station.innerHTML = `<option value="">すべての駅</option>` + ss.map(x=>`<option>${esc(x)}</option>`).join("");
      renderNextTrains();
    };
  }

  function searchTrain() {
    const q = norm($("trainNumberInput")?.value);
    if (!q) return;
    const found = trains.find(t => norm(t.trainNumber) === q) ||
                  trains.find(t => norm(t.trainNumber).startsWith(q));
    const box = $("trainSearchResult");
    if (!found) {
      if (box) box.innerHTML = `<div class="search-empty">列車番号「${esc(q)}」が見つかりませんでした。</div>`;
      return;
    }
    if (box) box.innerHTML = `<button class="found-train" data-id="${esc(found.id)}"><b>${esc(found.trainNumber)}</b>　${esc(found.type)}　${esc(found.origin)} → ${esc(found.destination)}<small>${esc(found.crew)}</small></button>`;
    selectTrain(found, true);
  }

  function selectTrain(t, detail=true) {
    selected = t;
    selectedStation = "";
    fillMain(t);
    fillDetail(t);
    if (detail) {
      $("detailView")?.removeAttribute("hidden");
      $("listView")?.setAttribute("hidden","");
      window.scrollTo(0,0);
    }
  }

  function fillMain(t) {
    const type = typeName(t.type);
    setText("trainType", type);
    setText("serviceCode", TYPE_ICON[type] || type);
    setText("trainNo", t.trainNumber);
    setText("origin", t.origin || "—");
    setText("destination", t.destination || "—");
    setText("metricLine", routeLabel(t));
    setText("metricPosition", t.origin || "—");
    setText("detailCrewName", t.crew || crewFor(t.route));
    setText("detailType", type);
    setText("detailCode", TYPE_ICON[type] || type);
    setText("detailTrainNo", t.trainNumber);
    setText("detailOrigin", t.origin || "—");
    setText("detailDestination", t.destination || "—");
    setText("detailCrewState", "乗務中");
    const stops = stationsOf(t);
    setText("cars", t.cars ? `${t.cars}両` : (type === "ミュースカイ" ? "8両" : "—"));
    setText("detailCars", t.cars || "—");
    renderSchedule(stops);
    renderRouteMap(stops);
    renderTimetable();
    setText("heroSub", `${t.trainNumber}　${type}　${t.origin || ""} → ${t.destination || ""}`);
  }

  function fillDetail(t) {
    const rows = $("detailSchedule");
    if (!rows) return;
    const stops = stationsOf(t);
    rows.innerHTML = stops.map((s,i) => `
      <tr><td>${i===0?"始":i===stops.length-1?"終":"・"}</td>
      <td>${esc(s.station)}</td>
      <td>${esc(s.arrival || s.time || "—")}</td>
      <td>${esc(s.departure || s.time || "—")}</td></tr>
    `).join("");
    setText("detailNotice", `${routeLabel(t)} / ${t.trainNumber} / ${t.type}`);
  }

  function renderSchedule(stops) {
    const body = $("scheduleTable")?.querySelector("tbody");
    if (!body) return;
    body.innerHTML = stops.map((s,i) => {
      const time = s.time || s.departure || s.arrival || "—";
      return `<tr><td>${esc(s.station)}</td><td>${esc(s.arrival || time)}</td><td>${esc(s.departure || time)}</td><td>${i===0?"始発":i===stops.length-1?"終着":"停車"}</td><td><button class="mini-btn" data-station="${esc(s.station)}">表示</button></td></tr>`;
    }).join("");
    body.querySelectorAll("[data-station]").forEach(b => b.onclick=()=> {
      selectedStation=b.dataset.station;
      setText("metricStation", selectedStation);
      setText("metricPosition", selectedStation);
    });
  }

  function renderRouteMap(stops) {
    const map = $("routeMap");
    if (!map) return;
    map.innerHTML = stops.map((s,i)=>`<div class="route-node ${i===0?"passed":""}"><span class="node-dot"></span><b>${esc(s.station)}</b><small>${esc(s.time || s.departure || "")}</small></div>`).join("");
  }

  function renderNextTrains() {
    const line = $("lineSelect")?.value || "";
    const type = $("typeSelect")?.value || "";
    let list = trains.filter(t => (!line || routeLabel(t)===line) && (!type || typeName(t.type)===type));
    list = list.slice(0,8);
    const box = $("nextTrains");
    if (box) box.innerHTML = list.map(t=>`<button class="next-train-item" data-train="${esc(t.id)}"><b>${esc(t.trainNumber)}</b><span>${esc(t.type)}</span><small>${esc(t.destination || "")}</small></button>`).join("");
    box?.querySelectorAll("[data-train]").forEach(b=>b.onclick=()=> {
      const t=trains.find(x=>x.id===b.dataset.train); if(t) selectTrain(t,true);
    });
  }

  function renderTimetable() {
    const box = $("timetableList");
    if (!box) return;
    const station = $("stationSelect")?.value || selectedStation;
    if (!station) {
      box.innerHTML = `<div class="empty-state">列車を選択すると停車駅・時刻を表示します。</div>`;
      return;
    }
    const rows=[];
    for (const t of trains) {
      const s=stationsOf(t).find(x=>x.station===station);
      if(s) rows.push({t,s});
    }
    box.innerHTML=rows.slice(0,20).map(x=>`<button class="next-train-item" data-train="${esc(x.t.id)}"><b>${esc(x.s.time || x.s.departure || "—")}</b><span>${esc(x.t.type)}</span><small>${esc(x.t.trainNumber)} → ${esc(x.t.destination)}</small></button>`).join("");
    box.querySelectorAll("[data-train]").forEach(b=>b.onclick=()=>{const t=trains.find(x=>x.id===b.dataset.train);if(t)selectTrain(t,true)});
  }

  function updateClock() {
    const d=new Date();
    const time=d.toLocaleTimeString("ja-JP",{hour12:false});
    const date=d.toLocaleDateString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"});
    setText("digital",time); setText("detailDigital",time); setText("dateText",date); setText("detailDate",date);
    drawClock("analog",d,190); drawClock("detailAnalog",d,220);
    if(selected) updateLive(selected,d);
  }

  function updateLive(t,d) {
    const stops=stationsOf(t);
    if(!stops.length) return;
    const mins=d.getHours()*60+d.getMinutes()+d.getSeconds()/60;
    let idx=0;
    for(let i=0;i<stops.length;i++){
      const m=parseTime(stops[i].time || stops[i].departure || stops[i].arrival);
      if(m!==null && m<=mins) idx=i;
    }
    const cur=stops[idx], next=stops[Math.min(idx+1,stops.length-1)];
    setText("currentLocation",`現在位置：${cur.station}`);
    setText("nextStop",`次駅：${next.station}`);
    const nm=parseTime(next.time || next.departure || next.arrival);
    const diff=nm===null?null:Math.max(0,Math.round(nm-mins));
    setText("eta",`到着まで ${diff===null?"—":diff+"分"}`);
    setText("metricStation",cur.station);
    setText("metricNext",next.time || next.departure || "--:--");
    setText("metricCountdown",diff===null?"—":`${diff}分後`);
    setText("positionUpdated",`更新 ${d.toLocaleTimeString("ja-JP",{hour12:false})}`);
  }

  function parseTime(v){
    if(!v) return null;
    const s=String(v).replace(/[^\d:]/g,"");
    let h,m;
    if(s.includes(":")) [h,m]=s.split(":").map(Number);
    else if(s.length>=3){ h=Number(s.slice(0,-2)); m=Number(s.slice(-2)); }
    else return null;
    if(h>=24) h%=24;
    return h*60+m;
  }

  function drawClock(id,d,size){
    const c=$(id); if(!c) return;
    const ctx=c.getContext("2d"), r=size/2;
    ctx.clearRect(0,0,size,size);
    ctx.beginPath();ctx.arc(r,r,r-5,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<12;i++){const a=i*Math.PI/6-Math.PI/2;ctx.beginPath();ctx.moveTo(r+Math.cos(a)*(r-15),r+Math.sin(a)*(r-15));ctx.lineTo(r+Math.cos(a)*(r-7),r+Math.sin(a)*(r-7));ctx.stroke();}
    const sec=d.getSeconds(), min=d.getMinutes(), hr=d.getHours()%12+min/60;
    hand(ctx,r,hr*Math.PI/6,r*.45,3);hand(ctx,r,min*Math.PI/30,r*.62,2);hand(ctx,r,sec*Math.PI/30,r*.72,1);
  }
  function hand(ctx,r,a,len,w){ctx.beginPath();ctx.lineWidth=w;ctx.moveTo(r,r);ctx.lineTo(r+Math.sin(a)*len,r-Math.cos(a)*len);ctx.stroke();}

  function setText(id,v){const e=$(id);if(e)e.textContent=v;}
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  function init(){
    $("trainSearchBtn")?.addEventListener("click",searchTrain);
    $("trainNumberInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")searchTrain()});
    $("typeSelect")?.addEventListener("change",renderNextTrains);
    $("stationSelect")?.addEventListener("change",renderTimetable);
    $("detailBack")?.addEventListener("click",()=>{$("detailView")?.setAttribute("hidden","");$("listView")?.removeAttribute("hidden")});
    $("backBtn")?.addEventListener("click",()=>{$("detailView")?.setAttribute("hidden","");$("listView")?.removeAttribute("hidden")});
    $("refreshBtn")?.addEventListener("click",loadData);
    $("officialBtn")?.addEventListener("click",()=>window.open(OFFICIAL_URL,"_blank"));
    $("officialMenu")?.addEventListener("click",()=>window.open(OFFICIAL_URL,"_blank"));
    $("darkToggle")?.addEventListener("change",e=>document.body.classList.toggle("dark",e.target.checked));
    $("themeBtn")?.addEventListener("click",()=>document.body.classList.toggle("dark"));
    $("detailTheme")?.addEventListener("click",()=>document.body.classList.toggle("dark"));
    $("zoomIn")?.addEventListener("click",()=>document.documentElement.style.fontSize="112%");
    $("zoomOut")?.addEventListener("click",()=>document.documentElement.style.fontSize="96%");
    $("detailZoomIn")?.addEventListener("click",()=>document.documentElement.style.fontSize="112%");
    $("detailZoomOut")?.addEventListener("click",()=>document.documentElement.style.fontSize="96%");
    setInterval(updateClock,1000); updateClock();
    loadData();
  }

  document.addEventListener("DOMContentLoaded",init);
  window.MeitetsuApp={get trains(){return trains},selectTrain};
})();

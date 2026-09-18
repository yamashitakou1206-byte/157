/* 名鉄 運転台表示 + 停車30秒前アラート + 時刻シミュレーター */
(() => {
  "use strict";

  const state = {
    train: null,
    timetable: [],
    mode: "sim",       // "real" or "sim"
    simSeconds: 16*3600 + 6*60,
    simRunning: false,
    simSpeed: 1,
    zoom: 1,
    selectedIndex: -1,
    alertStop: null,
    confirmed: false
  };

  const $ = id => document.getElementById(id);

  function pad(n){ return String(n).padStart(2,"0"); }

  function timeToSeconds(v){
    if(v == null) return null;
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(!m) return null;
    return +m[1]*3600 + +m[2]*60 + +(m[3]||0);
  }

  function secondsToTime(sec, withSeconds=true){
    sec = ((Math.floor(sec) % 86400) + 86400) % 86400;
    const h=Math.floor(sec/3600), m=Math.floor(sec%3600/60), s=sec%60;
    return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
  }

  function normalizeTime(v){
    const s=timeToSeconds(v);
    return s == null ? "--:--:--" : secondsToTime(s,true);
  }

  function first(obj, keys, fallback=null){
    for(const k of keys) if(obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fallback;
  }

  function normalizeStop(raw){
    return {
      station: first(raw,["station","stationName","name","駅","駅名"],""),
      arrival: first(raw,["arrival","arrivalTime","arrive","到着","着時刻","着"],null),
      departure: first(raw,["departure","departureTime","depart","発車","発時刻","発"],null),
      pass: first(raw,["pass","passing","通過","通過時刻"],null),
      cars: first(raw,["cars","carCount","carsCount","両数"],null)
    };
  }

  function normalizeTrain(raw){
    if(!raw || typeof raw !== "object") return null;
    const stopsRaw = first(raw,["stops","stations","timetable","時刻表","schedule"],[]);
    return {
      trainNo: first(raw,["trainNo","trainNumber","number","列車番号","列番"],""),
      type: first(raw,["type","trainType","種別"],""),
      cars: first(raw,["cars","carCount","carsCount","両数"],""),
      from: first(raw,["from","origin","departureStation","発駅","発"],""),
      to: first(raw,["to","destination","arrivalStation","着駅","着"],""),
      m: first(raw,["m","operation","運用記号","記号"],"M"),
      notice: first(raw,["notice","通告"],"通告"),
      stops: Array.isArray(stopsRaw) ? stopsRaw.map(normalizeStop) : []
    };
  }

  /* 既存の data/timetables.json を優先して読み込みます。
     配列・{trains:[...]}・単一列車の3形式に対応。 */
  async function loadTimetable(){
    const candidates = [
      "data/timetables.json",
      "data/timetable.json",
      "timetables.json"
    ];
    for(const url of candidates){
      try{
        const res=await fetch(url,{cache:"no-store"});
        if(!res.ok) continue;
        const data=await res.json();
        let arr = Array.isArray(data) ? data :
          Array.isArray(data.trains) ? data.trains :
          Array.isArray(data.timetables) ? data.timetables : [data];
        const trains=arr.map(normalizeTrain).filter(Boolean);
        if(trains.length){
          state.allTrains=trains;
          return trains;
        }
      }catch(e){}
    }
    state.allTrains=[];
    return [];
  }

  function useDemo(){
    /* JSONがまだない場合でも画面と30秒判定を即テスト可能 */
    state.allTrains=[normalizeTrain({
      trainNo:"5601E", type:"快急", cars:0, from:"並木", to:"常滑", m:"M",
      stops:[
        {station:"並木",arrival:"16:00:00",departure:"16:00:30"},
        {station:"常滑",arrival:"16:07:30",departure:"16:16:00"},
        {station:"中部国際空港",arrival:"16:21:00",departure:"16:22:00"}
      ]
    })];
  }

  function setTrain(train){
    state.train=train;
    state.selectedIndex=-1;
    renderTrainHeader();
    renderTable();
    updateAlert();
  }

  function renderTrainHeader(){
    const t=state.train;
    if(!t) return;
    $("typeBox").textContent=t.type || "—";
    $("carsBox").innerHTML=`${t.cars === "" ? "0" : t.cars}<span>両</span>`;
    $("mBox").textContent=t.m || "M";
    $("trainNo").textContent=t.trainNo || "—";
    $("fromStation").textContent=t.from || (t.stops[0]?.station || "—");
    $("toStation").textContent=t.to || (t.stops.at(-1)?.station || "—");
    applyTypeColor(t.type);
  }

  function applyTypeColor(type){
    const box=$("typeBox");
    const colors={
      "特急":"#e60012","快速特急":"#e60012","快急":"#e60012",
      "急行":"#e60012","準急":"#009b48","普通":"#333",
      "ミュースカイ":"#e60012"
    };
    box.style.background=colors[type] || "#009b48";
  }

  function renderTable(){
    const el=$("timetable");
    el.innerHTML="";
    if(!state.train) return;
    state.train.stops.forEach((st,i)=>{
      const row=document.createElement("div");
      row.className="row";
      row.dataset.index=i;
      const a=normalizeTime(st.arrival), d=normalizeTime(st.departure);
      row.innerHTML=`
        <div class="dot">${i===state.selectedIndex?"●":""}</div>
        <div class="station" title="${escapeHtml(st.station)}">${escapeHtml(st.station)}</div>
        <div class="time">${renderTime(a)}</div>
        <div class="time">${renderTime(d)}</div>`;
      row.addEventListener("click",()=>{
        state.selectedIndex = state.selectedIndex===i ? -1 : i;
        renderTable();
      });
      el.appendChild(row);
    });
  }

  function renderTime(v){
    if(!v || v==="--:--:--") return v;
    const m=v.match(/^(\d{2}:\d{2}):(\d{2})$/);
    if(!m) return escapeHtml(v);
    const sec=m[2];
    return `${m[1]}<span class="seconds ${sec==="00"?"zero":""}">${sec}</span>`;
  }

  function escapeHtml(s){
    return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function currentSeconds(){
    if(state.mode==="sim") return state.simSeconds;
    const n=new Date();
    return n.getHours()*3600+n.getMinutes()*60+n.getSeconds();
  }

  function nextStop(){
    if(!state.train) return null;
    const now=currentSeconds();
    for(let i=0;i<state.train.stops.length;i++){
      const st=state.train.stops[i];
      const a=timeToSeconds(st.arrival), d=timeToSeconds(st.departure);
      if(a==null && d==null) continue;
      if(a!=null && now < a) return {stop:st,index:i};
      if(a!=null && d!=null && now>=a && now<d) return {stop:st,index:i};
    }
    return null;
  }

  /* 30秒前から発車時刻まで赤パネルを表示 */
  function updateAlert(){
    const n=nextStop();
    if(!n){ hideAlert(); return; }
    const a=timeToSeconds(n.stop.arrival);
    const d=timeToSeconds(n.stop.departure);
    if(a==null){ hideAlert(); return; }
    const end=d!=null ? d : a+60;
    const now=currentSeconds();
    if(now>=a-30 && now<end){
      if(state.alertStop!==n.stop){
        state.alertStop=n.stop;
        state.confirmed=false;
        showAlert(n.stop);
      }
    }else{
      hideAlert();
    }
    highlightCurrentRow(n.index,now,a,d);
  }

  function showAlert(st){
    $("alertCars").textContent = st.cars ?? state.train?.cars ?? 0;
    $("alertStation").textContent = `${st.station}停車`;
    $("alertArrival").textContent = normalizeTime(st.arrival);
    $("alertDeparture").textContent = normalizeTime(st.departure);
    $("stopConfirmButton").textContent="停車確認";
    $("stopConfirmButton").classList.remove("confirmed");
    $("stopAlert").classList.remove("hidden");
  }

  function hideAlert(){
    state.alertStop=null;
    $("stopAlert").classList.add("hidden");
  }

  function highlightCurrentRow(index,now,a,d){
    document.querySelectorAll(".row").forEach((r,i)=>{
      r.classList.remove("selected","past");
      if(i===index && now>=a-30 && (d==null || now<d)) r.classList.add("selected");
      if(d!=null && now>=d) r.classList.add("past");
    });
  }

  function updateClock(){
    const now=new Date();
    const shown=currentSeconds();
    $("digital").textContent=secondsToTime(shown,true);
    $("dateText").textContent=`${secondsToTime(shown,true)}　${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())}`;
    drawClock(shown);
  }

  function drawClock(sec){
    const c=$("clock"),ctx=c.getContext("2d"),w=c.width,h=c.height,r=Math.min(w,h)/2-10,cx=w/2,cy=h/2;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle=document.body.classList.contains("dark")?"#dbe3ef":"#7f8fa3";
    ctx.fillStyle=document.body.classList.contains("dark")?"#fff":"#111";
    ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<60;i++){
      const a=i*Math.PI/30, len=i%5===0?14:6;
      ctx.lineWidth=i%5===0?2:1;
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*(r-len),cy+Math.sin(a)*(r-len));
      ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.stroke();
    }
    ctx.font="16px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
    for(let i=1;i<=12;i++){
      const a=i*Math.PI/6-Math.PI/2;
      ctx.fillText(String(i),cx+Math.cos(a)*(r-28),cy+Math.sin(a)*(r-28));
    }
    const h24=Math.floor(sec/3600)%24,m=Math.floor(sec/60)%60,s=sec%60;
    hand(ctx,cx,cy,r*.50,(h24%12+m/60)*Math.PI/6-Math.PI/2,5);
    hand(ctx,cx,cy,r*.72,(m+s/60)*Math.PI/30-Math.PI/2,4);
    hand(ctx,cx,cy,r*.82,s*Math.PI/30-Math.PI/2,2);
    ctx.fillStyle="#111";ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fill();
  }
  function hand(ctx,cx,cy,len,a,width){ctx.strokeStyle="#111";ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*len,cy+Math.sin(a)*len);ctx.stroke()}

  function simLoop(){
    if(state.simRunning && state.mode==="sim"){
      state.simSeconds=(state.simSeconds+state.simSpeed)%86400;
      updateAll();
    }
    setTimeout(simLoop,1000);
  }

  function updateAll(){
    updateClock();
    updateAlert();
    $("simReadout").textContent=secondsToTime(state.simSeconds,true);
  }

  function setSimInput(sec){
    state.simSeconds=((sec%86400)+86400)%86400;
    $("simTime").value=secondsToTime(state.simSeconds,true);
    updateAll();
  }

  function eventTest(){
    const n=nextStop();
    let st=n?.stop;
    if(!st && state.train?.stops?.length) st=state.train.stops[0];
    if(!st) return;
    const a=timeToSeconds(st.arrival);
    if(a==null){toast("到着時刻がない停車駅です");return;}
    setSimInput(a-31);
    state.simRunning=true;
    state.mode="sim";
    $("simMode").classList.add("selected");$("realMode").classList.remove("selected");
    toast(`${st.station}の30秒前から自動テストを開始しました`);
  }

  function toast(msg){
    const t=$("toast");t.textContent=msg;t.classList.remove("hidden");
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.add("hidden"),2200);
  }

  function setup(){
    $("simOpen").onclick=()=>$("simPanel").classList.toggle("hidden");
    $("simClose").onclick=()=>$("simPanel").classList.add("hidden");

    $("realMode").onclick=()=>{
      state.mode="real";state.simRunning=false;
      $("realMode").classList.add("selected");$("simMode").classList.remove("selected");
      updateAll();
    };
    $("simMode").onclick=()=>{
      state.mode="sim";
      $("simMode").classList.add("selected");$("realMode").classList.remove("selected");
      updateAll();
    };
    $("simTime").onchange=()=>{
      const s=timeToSeconds($("simTime").value);if(s!=null)setSimInput(s);
    };
    document.querySelectorAll("[data-speed]").forEach(b=>b.onclick=()=>{
      state.simSpeed=+b.dataset.speed;
      document.querySelectorAll("[data-speed]").forEach(x=>x.classList.remove("selected"));
      b.classList.add("selected");
    });
    $("minus30").onclick=()=>setSimInput(state.simSeconds-30);
    $("plus30").onclick=()=>setSimInput(state.simSeconds+30);
    $("plus60").onclick=()=>setSimInput(state.simSeconds+60);
    $("simPlay").onclick=()=>{state.mode="sim";state.simRunning=true;toast("シミュレーター再生");};
    $("simPause").onclick=()=>{state.simRunning=false;toast("一時停止");};
    $("eventTest").onclick=eventTest;

    $("stopConfirmButton").onclick=()=>{
      state.confirmed=true;
      $("stopConfirmButton").textContent="確認済";
      $("stopConfirmButton").classList.add("confirmed");
    };

    $("themeBtn").onclick=()=>{document.body.classList.toggle("dark");updateClock()};
    $("zoomIn").onclick=()=>{state.zoom=Math.min(1.25,state.zoom+.05);document.querySelector(".screen").style.transform=`scale(${state.zoom})`;document.querySelector(".screen").style.transformOrigin="top left"};
    $("zoomOut").onclick=()=>{state.zoom=Math.max(.8,state.zoom-.05);document.querySelector(".screen").style.transform=`scale(${state.zoom})`;document.querySelector(".screen").style.transformOrigin="top left"};
    $("backBtn").onclick=()=>{
      // 単体Web/PWAでも「接続してください」と表示しない。
      // 履歴があれば前の画面へ戻り、なければ何もしない。
      if (window.history.length > 1) window.history.back();
    };

    document.querySelector('[data-speed="1"]').classList.add("selected");
    setInterval(()=>{if(state.mode==="real")updateAll()},1000);
    simLoop();
  }

  async function init(){
    setup();
    const trains=await loadTimetable();
    if(trains.length) setTrain(trains[0]);
    else {useDemo();setTrain(state.allTrains[0]);toast("JSONが見つからないためテストデータを表示しています");}
    updateAll();
  }

  init();
})();

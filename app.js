const OFFICIAL_URL='https://top.meitetsu.co.jp/em/train_emtop.asp';
const OFFICIAL_TIMETABLE_URL='https://www.meitetsu.co.jp/train/timetable/';

const lines={
 main:{name:'名古屋本線',crew:'名古屋乗務区',color:'#c40018',stations:['豊橋','伊奈','小田渕','国府','御油','名電赤坂','名電長沢','本宿','名電山中','藤川','美合','男川','東岡崎','岡崎公園前','矢作橋','宇頭','新安城','牛田','知立','一ツ木','富士松','豊明','前後','中京競馬場前','有松','左京山','鳴海','本星崎','本笠寺','桜','呼続','堀田','神宮前','金山','山王','名鉄名古屋','栄生','東枇杷島','西枇杷島','二ツ杁','新川橋','須ケ口','丸ノ内','新清洲','大里','奥田','国府宮','島氏永','妙興寺','名鉄一宮','今伊勢','石刀','新木曽川','黒田','木曽川堤','笠松','岐南','茶所','加納','名鉄岐阜']},
 toyokawa:{name:'豊川線',crew:'名古屋乗務区',color:'#7b2cbf',stations:['国府','八幡','諏訪町','稲荷口','豊川稲荷']},
 nishio:{name:'西尾線・蒲郡線',crew:'知立乗務区',color:'#b00062',stations:['新安城','北安城','南安城','碧海古井','堀内公園','桜井','南桜井','米津','桜町前','西尾口','西尾','福地','上横須賀','吉良吉田','三河鳥羽','西幡豆','東幡豆','こどもの国','西浦','形原','三河鹿島','蒲郡競艇場前','蒲郡']},
 mikawa:{name:'三河線',crew:'知立乗務区',color:'#006b3f',stations:['知立','重原','刈谷','刈谷市','小垣江','三河高浜','高浜港','北新川','新川町','碧南','三河知立','三河八橋','若林','竹村','土橋','上挙母','豊田市','梅坪','越戸','平戸橋','猿投']},
 toyota:{name:'豊田線・地下鉄鶴舞線',crew:'知立乗務区',color:'#008b8b',stations:['上小田井','庄内緑地公園','庄内通','浄心','浅間町','丸の内','伏見','大須観音','上前津','鶴舞','塩釜口','植田','原','平針','赤池','米野木','日進','黒笹','三好ケ丘','浄水','上豊田','梅坪','豊田市']},
 tokoname:{name:'常滑線・空港線',crew:'神宮前乗務区',color:'#009a9a',stations:['神宮前','豊田本町','道徳','大江','大同町','柴田','名和','聚楽園','新日鉄前','太田川','尾張横須賀','寺本','朝倉','古見','長浦','日長','新舞子','大野町','西ノ口','蒲池','榎戸','多屋','常滑','りんくう常滑','中部国際空港']},
 kowa:{name:'河和線・知多新線',crew:'神宮前乗務区',color:'#ef7b00',stations:['太田川','高横須賀','加木屋中ノ池','南加木屋','八幡新田','巽ケ丘','白沢','坂部','阿久比','植大','半田口','住吉町','知多半田','成岩','青山','上ゲ','知多武豊','富貴','布土','河和口','河和','上野間','美浜緑苑','知多奥田','野間','内海']},
 tsushima:{name:'津島線',crew:'名古屋乗務区',color:'#7c49a5',stations:['須ケ口','甚目寺','七宝','木田','青塚','勝幡','藤浪','津島','五ノ三','佐屋','日比野','弥富']},
 biwajima:{name:'尾西線',crew:'名古屋乗務区',color:'#8b5a2b',stations:['玉ノ井','奥町','開明','西一宮','名鉄一宮','観音寺','苅安賀','二子','萩原','玉野','山崎','森上','上丸渕','丸渕','渕高','六輪','町方','津島']},
 inuyama:{name:'犬山線・各務原線',crew:'犬山乗務区',color:'#0075c9',stations:['神宮前','豊橋方面接続','金山','名鉄名古屋','栄生','上小田井','西春','徳重・名古屋芸大','大山寺','岩倉','石仏','布袋','江南','柏森','扶桑','木津用水','犬山口','犬山','新鵜沼','鵜沼宿','羽場','各務原市役所前','市民公園前','新那加','新加納','高田橋','手力','切通','細畑','田神','名鉄岐阜']},
 hiro:{name:'広見線',crew:'犬山乗務区',color:'#3566b8',stations:['犬山','富岡前','善師野','西可児','可児川','日本ライン今渡','新可児','明智','顔戸','御嵩口','御嵩']},
 komaki:{name:'小牧線・地下鉄上飯田線',crew:'犬山乗務区',color:'#a33b99',stations:['平安通','上飯田','味鋺','味美','春日井','牛山','間内','小牧口','小牧','小牧原','味岡','田県神社前','楽田','羽黒','犬山']},
 takehana:{name:'竹鼻線・羽島線',crew:'名古屋乗務区',color:'#3f51b5',stations:['笠松','西笠松','柳津','南宿','須賀','不破一色','竹鼻','羽島市役所前','江吉良','新羽島']},
 seto:{name:'瀬戸線',crew:'瀬戸運輸区',color:'#008c45',stations:['栄町','東大手','清水','尼ケ坂','森下','大曽根','矢田','守山自衛隊前','瓢箪山','小幡','喜多山','大森・金城学院前','印場','旭前','尾張旭','三郷','水野','新瀬戸','瀬戸市役所前','尾張瀬戸']},
 chikko:{name:'築港線',crew:'神宮前乗務区',color:'#5d5d5d',stations:['大江','東名古屋港']}
};

const demoTrains={
 '1980S':{type:'普通',code:'M',cars:2,crew:'名古屋乗務区',route:'尾西線',origin:'一宮',destination:'津島',notice:'デモ列車',state:'乗務開始',stops:[['一宮','19:14'],['観音寺','19:16'],['苅安賀','19:18'],['二子','19:20'],['萩原','19:22'],['玉野','19:29'],['山崎','19:32'],['森上','19:34'],['上丸渕','19:38'],['丸渕','19:40'],['渕高','19:42'],['六輪','19:45'],['町方','19:47'],['津島','19:50']]},
 '1800M':{type:'普通',code:'M',cars:2,origin:'豊橋',destination:'名鉄岐阜',route:'名古屋本線',notice:'デモ列車',state:'運転中',stops:[['豊橋','18:01'],['国府','18:10'],['東岡崎','18:23'],['知立','18:35'],['神宮前','18:51'],['金山','18:55'],['名鉄名古屋','18:59'],['一宮','19:14'],['笠松','19:24'],['名鉄岐阜','19:30']]},
 '2100I':{type:'急行',code:'I',cars:6,origin:'名鉄名古屋',destination:'犬山',route:'犬山線',notice:'デモ列車',state:'運転中',stops:[['名鉄名古屋','21:00'],['上小田井','21:07'],['岩倉','21:17'],['江南','21:24'],['柏森','21:31'],['犬山','21:40']]}
};

let officialData=null, officialDataPromise=null;
const $=id=>document.getElementById(id), pad=n=>String(n).padStart(2,'0');
const now=()=>new Date();
const timeStr=(d,sec=true)=>`${pad(d.getHours())}:${pad(d.getMinutes())}${sec?':'+pad(d.getSeconds()):''}`;
const normalizeTrainNo=q=>String(q||'').trim().toUpperCase().replace(/\s+/g,'').replace(/[＊*]$/,'');
const holiday=()=>[0,6].includes(now().getDay());
const scheduleLabel=()=>holiday()?'土・休日':'平日';
const line=()=>lines[state.line];
let state={line:'main',stationIndex:0,direction:'up',type:'普通',dark:false,seconds:true,auto:true,notify:false,zoom:1,favorites:[],detail:null};

function toast(t){const e=$('toast');if(!e)return;e.textContent=t;e.classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>e.classList.remove('show'),2300)}
function save(){localStorage.setItem('meitetsuOperationV6',JSON.stringify({...state,detail:null}))}
function load(){try{Object.assign(state,JSON.parse(localStorage.getItem('meitetsuOperationV6')||'{}'))}catch(e){}}
function officialTrainList(){if(!officialData)return [];if(Array.isArray(officialData.trains))return officialData.trains;if(officialData.trains&&typeof officialData.trains==='object')return Object.values(officialData.trains);return []}
function isOfficialReady(){return officialTrainList().length>0}

async function loadOfficialData(){
  if(officialDataPromise)return officialDataPromise;
  officialDataPromise=fetch('./data/timetables.json?ts='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('data');return r.json()}).then(d=>{
    officialData=d;
    const count=officialTrainList().length;
    const el=$('dataStatus');
    if(el){el.className=count?'data-status ok':'data-status warn';const rev=d.revision||d.timetableRevision||'—';el.textContent=count?`公式PDF解析データ：${count}件・${rev}改正`:'公式PDF解析データはまだ生成されていません。Actionsから更新してください。'}
    return d;
  }).catch(()=>{officialData=null;const el=$('dataStatus');if(el){el.className='data-status warn';el.textContent='公式PDF解析データ未配置。GitHub Actionsの「名鉄公式時刻表データ更新」を実行してください。'}return null});
  return officialDataPromise;
}
function findOfficialTrains(q){
  if(!isOfficialReady())return [];
  const n=normalizeTrainNo(q);
  const list=officialTrainList().filter(t=>{
    const no=t.no ?? t.trainNumber ?? t.number ?? t.id;
    return normalizeTrainNo(no)===n;
  });
  // 現在のActions生成データはdayを持たない場合があるため、
  // dayが無いデータはそのまま検索対象にする。dayがある場合だけ曜日を優先。
  const wanted=holiday()?'holiday':'weekday';
  const preferred=list.filter(t=>!t.day||t.day===wanted);
  const rest=list.filter(t=>t.day&&t.day!==wanted);
  return [...preferred,...rest];
}
function crewForRoute(route){
  const r=String(route||'');
  if(/瀬戸/.test(r))return'瀬戸運輸区';
  if(/犬山|各務原|広見|小牧/.test(r))return'犬山乗務区';
  if(/常滑|空港|河和|知多新|築港/.test(r))return'神宮前乗務区';
  if(/三河|豊田|西尾|蒲郡/.test(r))return'知立乗務区';
  if(/名古屋本線|豊川|津島|尾西|竹鼻|羽島/.test(r))return'名古屋乗務区';
  return'—';
}
function typeFull(t){return ({'μS':'ミュースカイ','μＳ':'ミュースカイ','快特':'快速特急','特急':'特急','快急':'快速急行','急行':'急行','準急':'準急','普通':'普通'})[t]||t||'—'}
function detailFromOfficial(t){
  const rawStops=Array.isArray(t.stops)?t.stops:[];
  const stops=rawStops.map(x=>{
    if(Array.isArray(x))return [x[0]||'',x[1]||'',x[2]||x[1]||''];
    if(x&&typeof x==='object')return [x.station||x.name||'',x.arrival||x.time||x.departure||'',x.departure||x.time||x.arrival||''];
    return ['','',''];
  }).filter(x=>x[0]&&x[1]);
  const no=t.no ?? t.trainNumber ?? t.number ?? '—';
  const route=t.route||routeFromPdf(t.sourcePdf||t.pdf||'')||'—';
  const destination=t.destination||stops.at(-1)?.[0]||'—';
  const origin=t.origin||stops[0]?.[0]||'—';
  return {type:typeFull(t.type),code:serviceCodeForRoute(route),cars:t.cars??'—',crew:crewForRoute(route),origin,destination,notice:`名鉄公式路線別時刻表 / ${t.day==='holiday'?'土・休日':'平日'} / ${route}`,state:'時刻表',stops,no:String(no),route,day:t.day,pdf:t.sourcePdf||t.pdf};
}
function routeFromPdf(pdf){
  const s=String(pdf||'');
  if(/NH/i.test(s))return'名古屋本線';
  if(/TY|豊川/i.test(s))return'豊川線';
  if(/GN|Nishio/i.test(s))return'西尾線・蒲郡線';
  if(/MY|三河/i.test(s))return'三河線';
  if(/TT|豊田/i.test(s))return'豊田線・地下鉄鶴舞線';
  if(/TA/i.test(s))return'常滑線・空港線・河和線・知多新線';
  if(/CH|築港/i.test(s))return'築港線';
  if(/ST|瀬戸/i.test(s))return'瀬戸線';
  if(/TS|津島/i.test(s))return'津島線・尾西線';
  if(/IY/i.test(s))return'犬山線・各務原線';
  if(/HM|広見/i.test(s))return'広見線';
  if(/KM|小牧/i.test(s))return'小牧線・地下鉄上飯田線';
  if(/TH|竹鼻/i.test(s))return'竹鼻線・羽島線';
  return'';
}
function serviceCodeForRoute(route){
  const r=String(route||'');
  if(/名古屋本線/.test(r))return'M';
  if(/瀬戸/.test(r))return'S';
  if(/犬山|各務原/.test(r))return'I';
  if(/常滑|空港/.test(r))return'T';
  if(/河和|知多/.test(r))return'K';
  if(/津島|尾西/.test(r))return'T';
  if(/三河|豊田/.test(r))return'M';
  if(/西尾|蒲郡/.test(r))return'N';
  return'—';
}

function initSelectors(){
  $('lineSelect').innerHTML=Object.entries(lines).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('');
  $('lineSelect').value=lines[state.line]?state.line:'main';state.line=$('lineSelect').value;fillStations();
  $('directionSelect').value=state.direction;$('typeSelect').value=state.type;$('darkToggle').checked=state.dark;$('secondsToggle').checked=state.seconds;$('autoRefresh').checked=state.auto;$('notifyToggle').checked=state.notify;renderQuick();
}
function fillStations(){const l=line();$('stationSelect').innerHTML=l.stations.map((s,i)=>`<option value="${i}">${s}</option>`).join('');state.stationIndex=Math.min(Math.max(+state.stationIndex||0,0),l.stations.length-1);$('stationSelect').value=state.stationIndex}
function renderQuick(){
  $('quickLines').innerHTML=Object.entries(lines).map(([k,v])=>`<button class="quick ${k===state.line?'active':''}" data-line="${k}"><i style="background:${v.color}"></i>${v.name}</button>`).join('');
  document.querySelectorAll('.quick').forEach(b=>b.onclick=()=>setLine(b.dataset.line));
}
function setLine(k){state.line=k;state.stationIndex=0;$('lineSelect').value=k;fillStations();renderQuick();update();save()}
function demoTrain(){const l=line(),o=state.direction==='up'?l.stations[0]:l.stations.at(-1),d=state.direction==='up'?l.stations.at(-1):l.stations[0];const type=state.type;return{type,code:{main:'M',seto:'S',inuyama:'I',tokoname:'T',kowa:'K',tsushima:'T',mikawa:'M',nishio:'N',biwajima:'B'}[state.line]||'L',cars:{普通:2,準急:4,急行:6,快速急行:6,快速特急:8,特急:6,ミュースカイ:8}[type]||2,no:`${1800+state.stationIndex}${state.line==='main'?'M':'S'}`,origin:o,destination:d,route:l.name,crew:l.crew,notice:'表示用デモ列車',state:'表示中',stops:l.stations.map((s,i)=>[s,`${pad(6+Math.floor(i/2))}:${pad((i*7)%60)}`])}}
function trainForDisplay(){return demoTrain()}

function searchTrain(){
  const q=normalizeTrainNo($('trainNumberInput').value);
  if(!q){$('trainSearchResult').textContent='列車番号を入力してください。';return}
  const found=findOfficialTrains(q);
  if(found.length){
    $('trainSearchResult').innerHTML=found.slice(0,6).map((t,i)=>{const no=t.no??t.trainNumber??t.number??'—';const route=t.route||routeFromPdf(t.sourcePdf||t.pdf||'')||'—';return `<button class="search-train-result" data-i="${i}"><b>${no}</b><span>${typeFull(t.type)}　${t.destination||'—'}</span><small>${route} / ${t.day==='holiday'?'土・休日':'平日'} / ${t.direction==='down'?'下り':'上り'}</small></button>`}).join('');
    const buttons=document.querySelectorAll('.search-train-result');buttons.forEach((b,i)=>b.onclick=()=>showDetail(detailFromOfficial(found[i])));
  }else if(demoTrains[q]){
    showDetail(demoTrains[q]);
  }else{
    $('trainSearchResult').innerHTML='<span>該当列車が見つかりません。公式データ更新後に再検索してください。</span>';
  }
}
function stationTimes(){
  const l=line(),start=state.direction==='up'?0:l.stations.length-1,d=now(),base=Math.floor((d.getHours()*60+d.getMinutes())/20)*20+20,speed={普通:5,準急:4,急行:3,快速急行:3,快速特急:2,特急:2,ミュースカイ:2}[state.type]||5;
  return l.stations.map((name,i)=>{const dist=Math.abs(i-start),m=base+dist*speed;return{name,idx:i,minutes:m,arrival:`${pad(Math.floor(m/60)%24)}:${pad(m%60)}`,departure:`${pad(Math.floor(m/60)%24)}:${pad((m+1)%60)}`}})
}
function currentIndex(){const l=line(),d=now(),cur=d.getHours()*60+d.getMinutes()+d.getSeconds()/60;let idx=Math.floor((cur-(5*60+30))/20);idx=Math.max(0,Math.min(l.stations.length-1,idx));return state.direction==='up'?idx:l.stations.length-1-idx}
function renderClock(){const d=now();$('digital').textContent=timeStr(d,state.seconds);$('dateText').textContent=`${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}（${'日月火水木金土'[d.getDay()]}）`}
function drawAnalog(canvas){if(!canvas)return;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,r=Math.min(w,h)*.42,d=now();ctx.clearRect(0,0,w,h);ctx.strokeStyle=getComputedStyle(document.body).color;ctx.fillStyle=getComputedStyle(document.body).color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();for(let i=0;i<12;i++){const a=i*Math.PI/6-Math.PI/2,x1=cx+Math.cos(a)*r*.9,y1=cy+Math.sin(a)*r*.9,x2=cx+Math.cos(a)*r,y2=cy+Math.sin(a)*r;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}const hand=(v,max,len,lw)=>{const a=v/max*Math.PI*2-Math.PI/2;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*len,cy+Math.sin(a)*len);ctx.stroke()};hand((d.getHours()%12)+d.getMinutes()/60,12,r*.55,5);hand(d.getMinutes()+d.getSeconds()/60,60,r*.72,3);hand(d.getSeconds(),60,r*.82,1);ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fill()}
function renderHeader(){const t=trainForDisplay();$('trainType').textContent=t.type;$('serviceCode').textContent=t.code;$('cars').textContent=t.cars+'両';$('origin').textContent=t.origin;$('destination').textContent=t.destination;$('trainNo').textContent=t.no;$('metricStation').textContent=line().stations[state.stationIndex];$('metricLine').textContent=line().name;document.documentElement.style.setProperty('--line-accent',line().color)}
function renderMap(){const times=stationTimes(),ci=currentIndex();$('routeMap').innerHTML=times.map((x,i)=>`<div class="map-stop ${i<ci?'passed':i===ci?'current':''}"><div class="map-dot"></div><div class="map-label">${x.name}</div><div class="map-time">${x.departure}</div></div>`).join('')}
function renderSchedule(){const times=stationTimes(),ci=currentIndex();$('scheduleTable tbody').innerHTML=times.map((x,i)=>`<tr class="${i===ci?'current':''}"><td><button class="station-link" data-index="${i}">${x.name}</button></td><td>${x.arrival}</td><td>${x.departure}</td><td>${i<ci?'<span class="state done">通過</span>':i===ci?'<span class="state now">停車中</span>':'<span class="state">予定</span>'}</td><td><button class="star-btn" data-station="${x.name}">${state.favorites.includes(x.name)?'★':'☆'}</button></td></tr>`).join('');
  document.querySelectorAll('.station-link').forEach(b=>b.onclick=()=>{state.stationIndex=+b.dataset.index;$('stationSelect').value=state.stationIndex;update()});document.querySelectorAll('.star-btn').forEach(b=>b.onclick=()=>toggleFavorite(b.dataset.station));
  const pos=times[ci],next=times[Math.min(ci+1,times.length-1)],cur=now(),cm=cur.getHours()*60+cur.getMinutes()+cur.getSeconds()/60;$('currentLocation').textContent=`現在位置：${pos?.name||'—'}`;$('nextStop').textContent=`次駅：${next?.name||'—'}`;$('eta').textContent=next?`次駅まで ${Math.max(0,Math.ceil(next.minutes-cm))}分`:'終着';$('metricPosition').textContent=pos?.name||'—'
}
function renderNext(){const l=line(),station=state.stationIndex,base=now(),types=['普通','準急','急行','快速急行','快速特急','特急'];let html='';for(let k=0;k<6;k++){const d=new Date(base.getTime()+(k*8+3+station%4)*60000),typ=types[(k+station)%types.length];html+=`<div class="next-item"><div class="next-time">${timeStr(d,false)}</div><div class="next-main"><strong>${typ}</strong><small>${state.direction==='up'?l.stations.at(-1):l.stations[0]} 行</small></div><span class="next-tag">${{普通:2,準急:4,急行:6,快速急行:6,快速特急:8,特急:6}[typ]}両</span></div>`}$('nextTrains').innerHTML=html;$('metricNext').textContent=timeStr(new Date(base.getTime()+(3+station%4)*60000),false);$('metricCountdown').textContent='次列車まで数分';$('timetableTitle').textContent=`${l.stations[station]} / ${scheduleLabel()}`;$('timetableList').innerHTML=html}
function renderFavorites(){const f=state.favorites||[];$('metricFav').textContent=f.length;$('favoritesList').innerHTML=f.length?f.map(s=>`<button class="favorite-chip" data-fav="${s}">★ ${s}</button>`).join(''):'<div class="empty">お気に入り駅はありません</div>';document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=()=>toast(`${b.dataset.fav} を選択`))}
function renderNews(){const d=now();$('lastUpdated').textContent=`更新 ${timeStr(d)}`;$('positionUpdated').textContent=`更新 ${timeStr(d)}`;$('newsList').innerHTML=`<div class="news-item"><strong>時刻表</strong><small>${scheduleLabel()}・2026年3月14日改正を基準に表示</small></div><div class="news-item"><strong>音声案内</strong><small>自動放送は使用しません。</small></div><div class="news-item"><strong>データ</strong><small>${isOfficialReady()?'公式PDF解析データを使用中':'デモデータを表示中'}</small></div>`}
function update(){renderClock();drawAnalog($('analog'));renderHeader();renderMap();renderSchedule();renderNext();renderFavorites();renderNews();applyTheme()}
function toggleFavorite(s){state.favorites=state.favorites||[];state.favorites=state.favorites.includes(s)?state.favorites.filter(x=>x!==s):[...state.favorites,s];save();renderFavorites();renderSchedule()}
function applyTheme(){document.body.classList.toggle('dark',!!state.dark);$('darkToggle').checked=!!state.dark}
function changeZoom(delta){state.zoom=Math.min(1.35,Math.max(.8,(state.zoom||1)+delta));document.documentElement.style.setProperty('--zoom',state.zoom);save();toast(`表示倍率 ${Math.round(state.zoom*100)}%`)}
function showDetail(d){state.detail=d;$('listView').hidden=true;$('detailView').hidden=false;document.querySelector('.bottom-nav').style.display='none';renderDetail();window.scrollTo(0,0)}
function hideDetail(){state.detail=null;$('detailView').hidden=true;$('listView').hidden=false;document.querySelector('.bottom-nav').style.display='grid';update();window.scrollTo(0,0)}
function renderDetail(){const d=state.detail;if(!d)return;$('detailCrewName').textContent=d.crew||'—';$('detailDate').textContent=`${timeStr(now(),false)}　${scheduleLabel()}`;$('detailType').textContent=d.type||'—';$('detailCode').textContent=d.code||'—';$('detailCars').textContent=d.cars==='—'?'—':d.cars;$('detailOrigin').textContent=d.origin||'—';$('detailDestination').textContent=d.destination||'—';$('detailTrainNo').textContent=d.no||'—';$('detailCrewState').textContent=d.state||'時刻表';$('detailNotice').textContent=d.notice||'名鉄公式時刻表由来の表示です。';$('detailSchedule').innerHTML=(d.stops||[]).map((s,i)=>`<tr class="${i===0?'detail-current':''}"><td class="row-mark">${i===0?'●':''}</td><td>${s[0]}</td><td>${s[1]||''}</td><td>${s[2]||s[1]||''}</td></tr>`).join('');$('detailDigital').textContent=timeStr(now(),true);drawAnalog($('detailAnalog'))}
function searchStation(){const q=$('stationSearch').value.trim();if(!q){$('searchResult').innerHTML='';return}const out=[];for(const [k,l] of Object.entries(lines))l.stations.forEach((s,i)=>{if(s.includes(q))out.push(`<button class="search-result" data-k="${k}" data-i="${i}">${s}<small>${l.name}</small></button>`)});$('searchResult').innerHTML=out.length?out.join(''):'<div class="empty">該当駅なし</div>';document.querySelectorAll('.search-result').forEach(b=>b.onclick=()=>{state.line=b.dataset.k;state.stationIndex=+b.dataset.i;$('lineSelect').value=state.line;fillStations();renderQuick();$('menuDialog').close();update()})}
function bind(){
  $('lineSelect').onchange=e=>{state.line=e.target.value;state.stationIndex=0;fillStations();renderQuick();update();save()};$('stationSelect').onchange=e=>{state.stationIndex=+e.target.value;update();save()};$('directionSelect').onchange=e=>{state.direction=e.target.value;update();save()};$('typeSelect').onchange=e=>{state.type=e.target.value;update();save()};$('trainSearchBtn').onclick=searchTrain;$('trainNumberInput').onkeydown=e=>{if(e.key==='Enter')searchTrain()};
  $('themeBtn').onclick=()=>{state.dark=!state.dark;applyTheme();save()};$('darkToggle').onchange=e=>{state.dark=e.target.checked;applyTheme();save()};$('secondsToggle').onchange=e=>{state.seconds=e.target.checked;save()};$('autoRefresh').onchange=e=>{state.auto=e.target.checked;save()};$('notifyToggle').onchange=e=>{state.notify=e.target.checked;toast('通知デモ '+(state.notify?'ON':'OFF'));save()};$('refreshBtn').onclick=()=>{officialDataPromise=null;loadOfficialData();update();toast('表示を更新しました')};$('zoomIn').onclick=()=>changeZoom(.1);$('zoomOut').onclick=()=>changeZoom(-.1);$('detailZoomIn').onclick=()=>changeZoom(.1);$('detailZoomOut').onclick=()=>changeZoom(-.1);$('detailBack').onclick=hideDetail;$('detailTheme').onclick=()=>{state.dark=!state.dark;applyTheme();renderDetail()};$('detailMenu').onclick=()=>toast('列車詳細メニュー');$('backBtn').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
  $('officialBtn').onclick=()=>window.open(OFFICIAL_URL,'_blank');$('officialMenu').onclick=()=>window.open(OFFICIAL_URL,'_blank');$('closeDialog').onclick=()=>$('menuDialog').close();$('menuBtn').onclick=()=>$('menuDialog').showModal();$('stationBtn').onclick=()=>{$('menuDialog').showModal();$('stationSearch').focus()};$('searchStation').onclick=searchStation;$('stationSearch').onkeydown=e=>{if(e.key==='Enter')searchStation()};$('clearFavorites').onclick=()=>{state.favorites=[];save();renderFavorites()};$('favoriteStation').onclick=()=>toggleFavorite(line().stations[state.stationIndex]);$('fullscreenBtn').onclick=()=>document.documentElement.requestFullscreen?.();
  document.querySelectorAll('.nav-item[data-target]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.target)?.scrollIntoView({behavior:'smooth'}));
}

load();state.favorites=Array.isArray(state.favorites)?state.favorites:[];initSelectors();document.documentElement.style.setProperty('--zoom',state.zoom||1);bind();update();
const dataLoadTimeout=setTimeout(()=>{const el=$('dataStatus');if(el&&el.textContent.includes('読み込み中')){el.className='data-status warn';el.textContent='時刻表データの読み込みを終了しました。未更新の場合はActionsから更新してください。'}},5000);
loadOfficialData().finally(()=>clearTimeout(dataLoadTimeout));
setInterval(()=>{if(state.detail){renderDetail()}else if(state.auto)update();else{renderClock();drawAnalog($('analog'))}},1000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

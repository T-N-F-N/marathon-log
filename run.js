"use strict";
/* ===== 実践モード：GPS計測・公式コースへの位置合わせ・音声案内 =====
   ブラウザアプリは画面が前面にある間しか動かない。
   そのため公式コース（GPX）上の位置から距離を割り出し、前面に戻った瞬間に正しい状況を表示・読み上げる。 */
const RUN_KEY = "marathon-run-live-v1";
const COURSE_KEY = "marathon-course-v1";

let R = null;          // 計測中の状態（localStorage に退避）
let C = null;          // 登録コース {name,total,pts:[[lat,lon,cumKm]]}
let watchId = null, wakeLock = null, tickId = null, demoId = null;
let gpsAcc = null, lastSpoken = "", wantStatus = false, finishArmed = false;
let map = null, layers = {};

// 神戸マラソン2026 公式サイト「マラソン競技情報」の関門（案）。閉鎖時刻は第1号砲 9:00 基準
const KOBE_GATES = [
  {name:"御旅公園", km:3.8, time:"10:00"}, {name:"工業技術センター", km:8.0, time:"10:36"},
  {name:"須磨一ノ谷プラザ", km:10.7, time:"10:59"}, {name:"舞子公園", km:17.5, time:"11:57"},
  {name:"大蔵海岸西", km:20.7, time:"12:25"}, {name:"舞子駅", km:23.9, time:"12:53"},
  {name:"垂水下水処理場", km:27.1, time:"13:23"}, {name:"須磨一ノ谷プラザ", km:31.1, time:"14:02"},
  {name:"須磨海浜公園", km:32.7, time:"14:18"}, {name:"駒ヶ林会館", km:35.4, time:"14:46"},
  {name:"中央卸売市場第7門", km:39.8, time:"15:33"}
];
function runCfg(){
  S.run = Object.assign({target:"", segs:[], gates:KOBE_GATES.map(g=>({...g})), gun:"09:00", voiceEvery:5, lapVoice:true, rate:1.05}, S.run||{});
  return S.run;
}
function loadCourse(){ try{ C = JSON.parse(localStorage.getItem(COURSE_KEY)||"null"); }catch(e){ C = null; } }
function saveCourse(){ try{ C ? localStorage.setItem(COURSE_KEY, JSON.stringify(C)) : localStorage.removeItem(COURSE_KEY); }catch(e){ toast("コースを保存できませんでした"); } }
function persistRun(){ try{ R ? localStorage.setItem(RUN_KEY, JSON.stringify(R)) : localStorage.removeItem(RUN_KEY); }catch(e){} }
function loadRun(){ try{ R = JSON.parse(localStorage.getItem(RUN_KEY)||"null"); }catch(e){ R = null; } }

/* ---------- 計算 ---------- */
const now = () => R && R.demo ? R.vnow : Date.now();
const raceDist = () => C ? C.total : 42.195;
const basePace = () => parseTime(runCfg().target) || goalPace() || 341;
function paceAt(km){
  let p = basePace();
  runCfg().segs.slice().sort((a,b)=>a.from-b.from).forEach(s=>{ if(km >= s.from && parseTime(s.pace)) p = parseTime(s.pace); });
  return p;
}
function targetTimeAt(d){
  const cuts = [0, ...runCfg().segs.map(s=>Number(s.from)).filter(x=>x>0&&x<d).sort((a,b)=>a-b), d];
  let t = 0;
  for(let i=0;i<cuts.length-1;i++) t += (cuts[i+1]-cuts[i]) * paceAt((cuts[i]+cuts[i+1])/2);
  return t;
}
function elapsed(){
  if(!R) return 0;
  const t = now();
  return (t - R.start - R.paused - (R.pauseAt ? t - R.pauseAt : 0)) / 1000;
}
const dist = () => R ? Math.max(0, (C ? (R.prog ?? 0) : R.raw) + R.off) : 0;
function curPace(){
  if(!R || R.recent.length < 2) return null;
  const a = R.recent[0], b = R.recent[R.recent.length-1];
  const dd = b[1]-a[1], dt = (b[0]-a[0])/1000;
  return dd > 0.05 && dt > 20 ? dt/dd : null;
}
function gateLeft(g){
  const [h,m] = String(g.time||"").split(":").map(Number);
  if(isNaN(h)) return null;
  if(todayStr()===S.settings.raceDate && !R?.demo){ const d = new Date(); d.setHours(h,m||0,0,0); return (d - Date.now())/1000; }
  const [gh,gm] = String(runCfg().gun||"09:00").split(":").map(Number);
  return (h*60+(m||0) - (gh*60+(gm||0)))*60 - elapsed();   // 練習日はスタート＝号砲とみなす
}
const nextGate = () => runCfg().gates.filter(g=>Number(g.km)>dist()).sort((a,b)=>a.km-b.km)[0] || null;

function hav(a,b){
  const R0 = 6371000, r = Math.PI/180, dLat = (b[0]-a[0])*r, dLon = (b[1]-a[1])*r;
  const s = Math.sin(dLat/2)**2 + Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLon/2)**2;
  return 2*R0*Math.asin(Math.sqrt(s));
}
function idxAt(km){
  let lo = 0, hi = C.pts.length-1;
  while(lo < hi){ const mid = (lo+hi) >> 1; if(C.pts[mid][2] < km) lo = mid+1; else hi = mid; }
  return lo;
}
function projectOnCourse(p, fromKm, toKm){
  const pts = C.pts, k = Math.cos(p[0]*Math.PI/180)*111320;
  let best = null;
  for(let i=Math.max(0,idxAt(fromKm)-1); i<Math.min(pts.length-1, idxAt(toKm)+1); i++){
    const a = pts[i], b = pts[i+1];
    const ax=(a[1]-p[1])*k, ay=(a[0]-p[0])*110540, bx=(b[1]-p[1])*k, by=(b[0]-p[0])*110540;
    const dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy;
    const t = L ? Math.max(0, Math.min(1, -(ax*dx+ay*dy)/L)) : 0;
    const off = Math.hypot(ax+t*dx, ay+t*dy);
    if(!best || off < best.off) best = {off, km:a[2]+t*(b[2]-a[2])};
  }
  return best;
}
function pointAtKm(km){
  const i = idxAt(km); if(i===0) return C.pts[0].slice(0,2);
  const a = C.pts[i-1], b = C.pts[i], t = (km-a[2])/((b[2]-a[2])||1);
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
}

/* ---------- 読み上げ ---------- */
let jaVoice = null;
function pickVoice(){
  if(!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  jaVoice = vs.find(v=>v.lang==="ja-JP" && /Kyoko|O-?ren|Google/.test(v.name)) || vs.find(v=>/^ja/.test(v.lang)) || null;
}
if("speechSynthesis" in window){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, interrupt){
  lastSpoken = text;
  const cap = document.getElementById("rmSaid"); if(cap) cap.textContent = "🔊 " + text;
  if(!("speechSynthesis" in window)) return;
  if(interrupt || R?.demo) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP"; if(jaVoice) u.voice = jaVoice; u.rate = Number(runCfg().rate)||1.05;
  speechSynthesis.speak(u);
}
function spDur(sec){
  sec = Math.round(Math.abs(sec));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  return (h?h+"時間":"") + (m?m+"分":"") + (!h && (s||!m) ? s+"秒" : "");
}
const spPace = sec => sec ? Math.floor(sec/60)+"分"+pad(Math.round(sec%60))+"秒" : "不明";
const spKm = km => (Math.floor(km*10)/10).toFixed(1).replace(/\.0$/,"") + "キロ";
// 2秒未満の差は「目標どおり」とまとめる
const lapDiffWords = d => Math.abs(d) < 2 ? "目標どおり" : `目標より${spDur(d)}${d>0?"遅い":"速い"}`;
const cumDiffWords = d => Math.abs(d) < 2 ? "累計は目標どおり" : `累計${spDur(d)}の${d>0?"遅れ":"貯金"}`;

function lapText(l, gapLaps){
  const tgt = targetTimeAt(l.km) - targetTimeAt(l.km-1);
  const cum = l.t - targetTimeAt(l.km);
  return (gapLaps>1 ? `画面オフの間に${gapLaps}キロ進みました。ラップは推定です。` : l.est ? "推定ラップです。" : "")
    + `${l.km}キロ。ラップ${spPace(l.sec)}、${lapDiffWords(l.sec-tgt)}。`
    + `${cumDiffWords(cum)}。次の1キロは${spPace(paceAt(l.km+0.5))}で。`;
}
function statusText(){
  const el = elapsed(), d = dist(), avg = d>0.05 ? el/d : null, cum = el - targetTimeAt(d);
  let s = `経過${spDur(el)}、${spKm(d)}。平均ペース${spPace(avg)}、${cumDiffWords(cum)}。`;
  const g = nextGate(), left = g ? gateLeft(g) : null;
  if(g && left!=null){
    const rem = g.km - d;
    if(left <= 0) s += `${g.name}の関門時刻を過ぎています。`;
    else { const req = left/rem;
      s += `次の関門、${g.name}、${spKm(g.km)}まであと${spKm(rem)}、閉鎖まで${spDur(left)}。必要ペース${spPace(req)}。`
        + (avg && avg > req ? "ペースを上げる必要があります。" : "今のペースで間に合います。"); }
  } else if(avg){
    const rem = Math.max(0, raceDist()-d);
    s += `ゴールまであと${spKm(rem)}。このペースならゴールは${spDur(el+rem*avg)}の見込み。`;
  }
  return s;
}

/* ---------- GPS ---------- */
function onFix(pos){
  gpsAcc = pos.coords.accuracy;
  const p = [pos.coords.latitude, pos.coords.longitude], t = now();
  if(!R || R.pauseAt){ updateRun(); return; }
  if(gpsAcc > 40){ updateRun(); return; }
  const el = elapsed(), prevD = dist();
  if(R.last){
    const d = hav(R.last.p, p), dt = Math.max(1, (t - R.last.t)/1000);
    if(d < Math.max(5, gpsAcc*0.4)) { updateRun(); return; }
    if(d/dt > 9) { updateRun(); return; }                      // 異常値（時速32km超）は捨てる
    R.raw += d/1000;
    if(C){
      const base = R.prog ?? 0, win = Math.max(0.6, dt*0.009);
      const pr = projectOnCourse(p, base-0.3, base+win);
      R.prog = pr && pr.off < 120 ? Math.max(base, pr.km) : base + d/1000;
    }
  } else if(C){
    const base = R.prog ?? 0, pr = projectOnCourse(p, Math.max(0, base-0.3), R.prog==null ? 1.5 : base+5);
    R.prog = pr && pr.off < 200 ? Math.max(base, pr.km) : base;
  }
  R.last = {p, t};
  const tr = R.track[R.track.length-1];
  if(!tr || hav(tr, p) >= 20) R.track.push([+p[0].toFixed(5), +p[1].toFixed(5)]);
  R.recent.push([t, dist()]); while(R.recent.length > 2 && t - R.recent[0][0] > 120000) R.recent.shift();
  checkLaps(prevD, el);
  R.lastEl = el;
  if(wantStatus){ wantStatus = false; say(statusText(), true); R.lastVoice = el; }
  updateRun();
  if(!R.demo && (!R.savedAt || Date.now()-R.savedAt > 10000)){ R.savedAt = Date.now(); persistRun(); }
}
function checkLaps(prevD, el){
  const d = dist(), gap = el - (R.lastEl||0) > 45, fresh = [];
  while(d >= R.nextKm && R.nextKm <= Math.ceil(raceDist())){
    const k = R.nextKm;
    const tc = d > prevD && prevD < k ? R.lastEl + (k-prevD)/(d-prevD)*(el-R.lastEl) : el;
    const lap = {km:k, sec:tc-R.lastLapT, t:tc, est:gap};
    R.laps.push(lap); fresh.push(lap); R.lastLapT = tc; R.nextKm++;
  }
  if(fresh.length && runCfg().lapVoice) { say(lapText(fresh[fresh.length-1], fresh.length)); R.lastVoice = el; }
}
function onGpsErr(e){
  const el = document.getElementById("rmGps");
  if(el) el.textContent = e.code===1 ? "位置情報が許可されていません" : "GPSを探しています…";
  if(e.code===1) toast("設定で位置情報の利用を許可してください");
}
function startGps(){
  if(watchId!=null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(onFix, onGpsErr, {enableHighAccuracy:true, maximumAge:0, timeout:20000});
}
function stopGps(){ if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId = null; } }
async function keepAwake(){
  try{ if(R && !R.pauseAt && "wakeLock" in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request("screen"); }catch(e){}
}

/* ---------- 計測の操作 ---------- */
function newRun(demo){
  const t = Date.now();
  R = {start:t, paused:0, pauseAt:null, raw:0, prog:null, off:0, last:null, lastEl:0, track:[], laps:[], lastLapT:0, nextKm:1, lastVoice:0, recent:[], demo:!!demo, vnow:t};
}
function startRun(demo){
  say("計測を開始します。", true);       // iPhoneはボタン操作の中で一度話すと、その後も読み上げられる
  newRun(demo);
  if(demo) startDemo(); else startGps();
  keepAwake(); startTick(); persistRun(); buildRun();
}
function pauseRun(){ if(!R || R.pauseAt) return; R.pauseAt = now(); persistRun(); say("一時停止しました。", true); buildRun(); }
function resumeRun(){ if(!R || !R.pauseAt) return; R.paused += now() - R.pauseAt; R.pauseAt = null; R.last = null; persistRun(); say("再開します。", true); keepAwake(); buildRun(); }
function finishRun(){
  const d = todayStr(), km = Math.round(dist()*100)/100, el = elapsed();
  if(!R.demo){
    const plan = activePlan()[d];
    ensureRegistered();
    S.logs[d] = Object.assign({}, S.logs[d]||{}, {
      status: plan && plan.km ? (km >= plan.km*0.9 ? "done" : "part") : "done",
      km, time: fmtTime(el),
      laps: R.laps.map(l=>({km:l.km, sec:Math.round(l.sec), est:!!l.est})),
      route: R.track.filter((_,i)=>i%3===0 || i===R.track.length-1), gps:true
    });
    save();
  }
  say(`お疲れさまでした。${spKm(km)}、${spDur(el)}。`, true);
  stopGps(); stopDemo(); clearInterval(tickId); tickId = null;
  try{ wakeLock && wakeLock.release(); }catch(e){}
  const wasDemo = R.demo; R = null; persistRun(); finishArmed = false;
  toast(wasDemo ? "デモを終了しました" : "記録に保存しました");
  buildRun(); render();
}
function startTick(){
  if(tickId) return;
  tickId = setInterval(()=>{
    if(!R) return;
    const el = elapsed(), every = Number(runCfg().voiceEvery)||0;
    if(!R.pauseAt && every && el - R.lastVoice >= every*60){ R.lastVoice = el; say(statusText()); }
    updateRun();
  }, 1000);
}

/* ---------- デモ走行（室内での動作確認） ---------- */
let DEMO_STEP = 15;   // 0.5秒ごとに進める仮想秒数（30倍速）
function startDemo(){
  let pos = C ? C.pts[0].slice(0,2) : [35.6852, 139.7528], along = 0, heading = 0;
  demoId = setInterval(()=>{
    if(!R) return;
    R.vnow += DEMO_STEP*1000;
    if(R.pauseAt) return;
    const v = 1000/basePace() * (0.94 + Math.random()*0.12);
    along += v*DEMO_STEP/1000;
    if(C){ if(along > C.total) along = C.total; pos = pointAtKm(along); }
    else { heading += (Math.random()-0.5)*0.3; pos = [pos[0] + Math.cos(heading)*v*DEMO_STEP/110540, pos[1] + Math.sin(heading)*v*DEMO_STEP/(111320*Math.cos(pos[0]*Math.PI/180))]; }
    if(along > 10 && along < 12.5) return;   // 10〜12.5kmは「画面オフ」を再現
    if(R.gapShown !== true && along >= 12.5){ R.gapShown = true; wantStatus = true; }
    onFix({coords:{latitude:pos[0]+(Math.random()-0.5)*0.00004, longitude:pos[1]+(Math.random()-0.5)*0.00004, accuracy:8}});
  }, 500);
}
function stopDemo(){ if(demoId){ clearInterval(demoId); demoId = null; } }

/* ---------- 画面 ---------- */
const runEl = () => document.getElementById("runMode");
function openRun(){
  runCfg(); loadCourse();
  const el = runEl(); el.hidden = false; document.body.style.overflow = "hidden";
  history.replaceState(null,"","#run");
  if(R && !R.demo){ startGps(); startTick(); keepAwake(); }
  buildRun();
}
function closeRun(){
  runEl().hidden = true; document.body.style.overflow = "";
  history.replaceState(null,"","#"+tab); render();
}
function fmtDiff(d){ const a = Math.round(Math.abs(d)); return (a<2 ? "±0" : (d>0?"+":"−")+fmtTime(a)); }

function buildRun(){
  const el = runEl(); if(!el || el.hidden) return;
  const cfg = runCfg(), running = R && !R.pauseAt;
  el.innerHTML = `
  <div class="rm-in">
    <div class="rm-top">
      <button class="rm-btn ghost" data-rm="close">← 通常画面</button>
      <span class="rm-gps" id="rmGps">${R ? (R.demo ? "デモ走行中" : "GPS待機中…") : C ? "コース：" + esc(C.name) : "コース未登録"}</span>
      <button class="rm-btn ghost" data-rm="setup" ${R?"disabled":""}>設定</button>
    </div>
    <div class="rm-main">
      <div class="rm-dist"><span id="rmDist">${fmtKm(dist()).padStart(1,"0")}</span><small>km</small></div>
      <div class="rm-time num" id="rmTime">${fmtTime(elapsed())}</div>
    </div>
    <div class="rm-grid">
      <div><span>現在ペース</span><b id="rmCur">—</b></div>
      <div><span>平均ペース</span><b id="rmAvg">—</b></div>
      <div><span>目標との差</span><b id="rmCum">—</b></div>
    </div>
    <div class="rm-card" id="rmLap"></div>
    <div class="rm-card" id="rmGate"></div>
    <p class="rm-said" id="rmSaid">${lastSpoken ? "🔊 "+esc(lastSpoken) : "アプリを前面に出すと、その時点の状況を読み上げます。"}</p>
    <div class="rm-actions">
      ${!R ? `<button class="rm-btn go" data-rm="start">スタート</button>`
        : `${running ? `<button class="rm-btn" data-rm="pause">一時停止</button>` : `<button class="rm-btn go" data-rm="resume">再開</button>`}
           <button class="rm-btn stop" data-rm="finish">${finishArmed ? "もう一度押すと終了" : "終了"}</button>`}
    </div>
    <div class="rm-actions">
      <button class="rm-btn ghost" data-rm="speak">いまの状況を読み上げ</button>
      ${R ? `<button class="rm-btn ghost" data-rm="fix">距離を補正</button>` : ""}
    </div>
    <div id="rmFix"></div>
    <div class="rm-map" id="rmMap">${window.L ? "" : `<p class="rm-said">地図は通信できるときに表示されます</p>`}</div>
    <div class="rm-laps" id="rmLaps"></div>
    ${!R ? `<div class="rm-card rm-help">
      <b>使い方</b>
      <ul>
        <li>「設定」で目標ペース・関門・公式コース（GPXファイル）を登録します。</li>
        <li>スタートを押したら、画面を消してポケットに入れて大丈夫です。</li>
        <li>確認したいときに画面をつけてアプリを開くと、その時点の距離・目標との差・関門までの必要ペースを読み上げます。</li>
        <li>画面がついている間は1kmごとにラップを読み上げます。</li>
        <li>コースを登録すると、画面を消していた間も距離が正確に出ます。未登録だと、画面を消していた区間は直線距離になり短めに出ます。</li>
      </ul>
      <button class="rm-btn ghost" data-rm="demo">デモ走行で試す（約30倍速）</button>
    </div>` : ""}
  </div>`;
  initMap(); updateRun();
}
function updateRun(){
  const el = runEl(); if(!el || el.hidden) return;
  const $ = id => document.getElementById(id);
  if(!$("rmDist")) return;
  const d = dist(), t = elapsed(), avg = d>0.05 ? t/d : null, cum = t - targetTimeAt(d), cp = curPace();
  $("rmDist").textContent = d.toFixed(2);
  $("rmTime").textContent = fmtTime(t);
  $("rmCur").textContent = cp ? fmtTime(cp) : "—";
  $("rmAvg").textContent = avg ? fmtTime(avg) : "—";
  const cumEl = $("rmCum"); cumEl.textContent = R && d>0.05 ? fmtDiff(cum) : "—"; cumEl.className = R && d>0.05 ? (cum>2 ? "bad" : "good") : "";
  if(R && !R.demo) $("rmGps").textContent = R.pauseAt ? "一時停止中" : gpsAcc==null ? "GPS待機中…" : `GPS精度 ±${Math.round(gpsAcc)}m`;
  const last = R?.laps[R.laps.length-1];
  const lapKm = R ? d - (R.nextKm-1) : 0;
  $("rmLap").innerHTML = `<div class="rm-row"><span>次の1km（${R?R.nextKm:1}km地点）</span><b>目標 ${fmtTime(paceAt((R?R.nextKm:1)-0.5))}</b></div>
    <div class="rm-bar"><i style="width:${Math.min(100,Math.max(0,lapKm*100))}%"></i></div>
    ${last ? `<div class="rm-row small"><span>直前のラップ（${last.km}km）${last.est?"・推定":""}</span><b>${fmtTime(last.sec)} <em class="${last.sec-(targetTimeAt(last.km)-targetTimeAt(last.km-1))>2?"bad":"good"}">${fmtDiff(last.sec-(targetTimeAt(last.km)-targetTimeAt(last.km-1)))}</em></b></div>` : ""}`;
  const g = nextGate(), left = g && R ? gateLeft(g) : null;
  $("rmGate").innerHTML = g ? `<div class="rm-row"><span>次の関門：${esc(g.name)}（${fmtKm(g.km)}km・${esc(g.time)}閉鎖）</span></div>
    ${R && left!=null ? `<div class="rm-grid two"><div><span>閉鎖まで</span><b>${left>0?fmtTime(left):"通過不可"}</b></div><div><span>必要ペース</span><b class="${avg && left>0 && avg > left/(g.km-d) ? "bad":"good"}">${left>0?fmtTime(left/(g.km-d)):"—"}</b></div></div>` : `<p class="small">計測を始めると必要ペースを表示します</p>`}`
    : `<div class="rm-row"><span>ゴールまで</span><b>${fmtKm(Math.max(0,raceDist()-d))} km</b></div>${avg?`<div class="rm-row small"><span>このペースでのゴール予想</span><b>${fmtTime(t+Math.max(0,raceDist()-d)*avg)}</b></div>`:""}`;
  const lapsEl = $("rmLaps");
  if(R && R.laps.length && lapsEl.dataset.n != R.laps.length){
    lapsEl.dataset.n = R.laps.length;
    lapsEl.innerHTML = `<table><thead><tr><th>km</th><th>ラップ</th><th>目標差</th><th>累計差</th></tr></thead><tbody>${R.laps.slice().reverse().map(l=>{
      const dl = l.sec-(targetTimeAt(l.km)-targetTimeAt(l.km-1)), dc = l.t-targetTimeAt(l.km);
      return `<tr><td>${l.km}</td><td>${fmtTime(l.sec)}${l.est?"*":""}</td><td class="${dl>2?"bad":"good"}">${fmtDiff(dl)}</td><td class="${dc>2?"bad":"good"}">${fmtDiff(dc)}</td></tr>`;}).join("")}</tbody></table>
      ${R.laps.some(l=>l.est)?`<p class="small">* 画面オフ中を含む推定ラップ</p>`:""}`;
  }
  updateMap();
}

function initMap(){
  const box = document.getElementById("rmMap");
  if(!window.L || !box) return;
  if(map){ map.remove(); map = null; }
  map = L.map(box, {zoomControl:false, attributionControl:true});
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:18, attribution:"© OpenStreetMap"}).addTo(map);
  layers = {};
  if(C){
    layers.course = L.polyline(C.pts.map(p=>[p[0],p[1]]), {color:"#8a93ad", weight:4, opacity:.8}).addTo(map);
    runCfg().gates.forEach(g=>{ if(g.km <= C.total) L.circleMarker(pointAtKm(Number(g.km)), {radius:6, color:"#ff8a7a", fillOpacity:1}).bindTooltip(g.name).addTo(map); });
    map.fitBounds(layers.course.getBounds(), {padding:[16,16]});
  } else map.setView([35.68,139.76], 12);
  layers.track = L.polyline([], {color:"#7aa0ff", weight:5}).addTo(map);
  layers.me = L.circleMarker([0,0], {radius:7, color:"#fff", weight:2, fillColor:"#2b57c4", fillOpacity:1});
  setTimeout(()=>map && map.invalidateSize(), 50);
}
function updateMap(){
  if(!map || !R || !R.last) return;
  layers.track.setLatLngs(R.track);
  layers.me.setLatLng(R.last.p); if(!map.hasLayer(layers.me)) layers.me.addTo(map);
  if(!R.followSet){ R.followSet = true; map.setView(R.last.p, 15); } else if(!map.getBounds().pad(-0.2).contains(R.last.p)) map.panTo(R.last.p);
}

/* ---------- 設定シート ---------- */
function openRunSetup(){
  const cfg = runCfg(), gp = goalPace();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<form class="sheet" id="rsForm" aria-label="実践モードの設定">
    <div class="sheet-grip"></div>
    <div class="spread"><h2>実践モードの設定</h2><button type="button" class="btn ghost" data-close>閉じる</button></div>

    <section class="panel">
      <h3>目標ペース</h3>
      <label class="field"><span>基本の目標ペース（分:秒/km）</span><input class="inp num" id="rsTarget" inputmode="numeric" placeholder="${gp?fmtTime(gp):"5:41"}" value="${esc(cfg.target)}"></label>
      <p class="small muted">空欄なら目標タイム（${esc(S.settings.goal)}）から計算した ${gp?fmtTime(gp):"—"}/km を使います。</p>
      <span class="label">ペース配分（任意）：この地点からペースを変える</span>
      <div class="stack" id="rsSegs">${cfg.segs.map(segRow).join("")}</div>
      <button type="button" class="btn" data-add="seg">＋ ペースの変更点を追加</button>
    </section>

    <section class="panel">
      <h3>関門</h3>
      <label class="field"><span>号砲（スタート）時刻</span><input class="inp" type="time" id="rsGun" value="${esc(cfg.gun)}"></label>
      <p class="small muted">レース当日は実際の時計で、練習の日は「スタートを押した時刻＝号砲」として計算します。神戸マラソンの閉鎖時刻は第1号砲（9:00）が基準なので、第2ウェーブ（9:15スタート）でも号砲は9:00のままにしてください。</p>
      <div class="stack" id="rsGates">${cfg.gates.map(gateRow).join("")}</div>
      <div class="row"><button type="button" class="btn" data-add="gate">＋ 関門を追加</button><button type="button" class="btn ghost" data-act="kobe">神戸マラソン2026の関門に戻す</button></div>
      <p class="small muted">初期値は公式サイトの関門（案）です。大会前に発表される最終版の「競技注意事項」で時刻を確認してください。</p>
    </section>

    <section class="panel">
      <h3>公式コース</h3>
      <p class="small">${C ? `登録済み：<b>${esc(C.name)}</b>（${fmtKm(C.total)}km）` : "未登録"}</p>
      <label class="field"><span>GPXファイルを読み込む</span><input class="inp" type="file" id="rsGpx" accept=".gpx,application/gpx+xml,application/xml,text/xml"></label>
      <p class="small muted">神戸マラソンは公式のGPXが配布されていません。公式のコース図を見ながら、地図サービスのルート作成機能でなぞってGPXを作ると使えます（手順は「使い方と公開手順」を参照）。コースがなくても、km表示の看板で「距離を補正」すれば関門の計算は正確になります。</p>
      ${C ? `<button type="button" class="btn danger" data-act="delcourse">コースを削除</button>` : ""}
    </section>

    <section class="panel">
      <h3>音声</h3>
      <label class="row"><input type="checkbox" id="rsLap" ${cfg.lapVoice?"checked":""}> 1kmごとにラップを読み上げる</label>
      <div class="grid2">
        <label class="field"><span>状況の定期読み上げ</span><select class="inp" id="rsEvery">${[0,3,5,10,15,20,30].map(m=>`<option value="${m}" ${Number(cfg.voiceEvery)===m?"selected":""}>${m?m+"分ごと":"しない"}</option>`).join("")}</select></label>
        <label class="field"><span>読み上げの速さ</span><select class="inp" id="rsRate">${[[0.9,"ゆっくり"],[1.05,"ふつう"],[1.25,"速め"]].map(([v,l])=>`<option value="${v}" ${Number(cfg.rate)===v?"selected":""}>${l}</option>`).join("")}</select></label>
      </div>
      <p class="small muted">画面を前面に出したときは、設定に関係なく毎回読み上げます。</p>
      <button type="button" class="btn" data-act="testvoice">音声テスト</button>
    </section>
    <button class="btn primary wide" type="submit">保存</button>
  </form>`;
  document.body.appendChild(bg);
  const f = bg.querySelector("form");
  const close = () => bg.remove();
  bg.addEventListener("click", e=>{
    if(e.target===bg || e.target.closest("[data-close]")) return close();
    const add = e.target.closest("[data-add]")?.dataset.add;
    if(add==="seg") f.querySelector("#rsSegs").insertAdjacentHTML("beforeend", segRow({from:"",pace:""}));
    if(add==="gate") f.querySelector("#rsGates").insertAdjacentHTML("beforeend", gateRow({name:"",km:"",time:""}));
    const rm = e.target.closest("[data-del]"); if(rm) rm.closest(".rs-row").remove();
    const act = e.target.closest("[data-act]")?.dataset.act;
    if(act==="testvoice"){ runCfg().rate = Number(f.querySelector("#rsRate").value); say("5キロ。ラップ5分38秒、目標より3秒速い。累計12秒の貯金。次の1キロは5分41秒で。", true); }
    if(act==="kobe"){ f.querySelector("#rsGates").innerHTML = KOBE_GATES.map(gateRow).join(""); f.querySelector("#rsGun").value = "09:00"; }
    if(act==="delcourse"){ C = null; saveCourse(); close(); buildRun(); toast("コースを削除しました"); }
  });
  f.querySelector("#rsGpx").addEventListener("change", async e=>{
    const file = e.target.files[0]; if(!file) return;
    const c = parseGpx(await file.text(), file.name.replace(/\.[^.]+$/,""));
    if(!c){ toast("コースを読み込めませんでした。GPXファイルか確認してください"); return; }
    C = c; saveCourse(); toast(`コースを登録しました（${fmtKm(C.total)}km）`);
    f.querySelector("#rsGpx").closest("section").querySelector("p").innerHTML = `登録済み：<b>${esc(C.name)}</b>（${fmtKm(C.total)}km）`;
  });
  f.addEventListener("submit", e=>{
    e.preventDefault();
    const t = f.querySelector("#rsTarget").value.trim();
    cfg.target = parseTime(t) ? t : "";
    cfg.segs = [...f.querySelectorAll("#rsSegs .rs-row")].map(r=>({from:Number(r.querySelector("[name=from]").value), pace:r.querySelector("[name=pace]").value.trim()})).filter(s=>s.from>0 && parseTime(s.pace));
    cfg.gates = [...f.querySelectorAll("#rsGates .rs-row")].map(r=>({name:r.querySelector("[name=gname]").value.trim()||"関門", km:Number(r.querySelector("[name=gkm]").value), time:r.querySelector("[name=gtime]").value})).filter(g=>g.km>0 && g.time).sort((a,b)=>a.km-b.km);
    cfg.gun = f.querySelector("#rsGun").value || "09:00";
    cfg.lapVoice = f.querySelector("#rsLap").checked;
    cfg.voiceEvery = Number(f.querySelector("#rsEvery").value);
    cfg.rate = Number(f.querySelector("#rsRate").value);
    save(); close(); buildRun(); toast("保存しました");
  });
}
const segRow = s => `<div class="rs-row"><input class="inp" name="from" type="number" inputmode="decimal" step="0.1" placeholder="km" value="${esc(s.from)}"><span class="small">kmから</span><input class="inp num" name="pace" inputmode="numeric" placeholder="5:35" value="${esc(s.pace)}"><span class="small">/km</span><button type="button" class="btn ghost" data-del aria-label="削除">✕</button></div>`;
const gateRow = g => `<div class="rs-row gate"><input class="inp" name="gname" placeholder="名前（例：中間点）" value="${esc(g.name)}"><input class="inp" name="gkm" type="number" inputmode="decimal" step="0.1" placeholder="km" value="${esc(g.km)}"><input class="inp" name="gtime" type="time" value="${esc(g.time)}"><button type="button" class="btn ghost" data-del aria-label="削除">✕</button></div>`;

function parseGpx(xml, name){
  try{
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    let nodes = [...doc.getElementsByTagName("trkpt")];
    if(nodes.length < 2) nodes = [...doc.getElementsByTagName("rtept")];
    const raw = nodes.map(n=>[Number(n.getAttribute("lat")), Number(n.getAttribute("lon"))]).filter(p=>isFinite(p[0]) && isFinite(p[1]));
    if(raw.length < 2) return null;
    const nm = doc.getElementsByTagName("name")[0]?.textContent?.trim() || name;
    const pts = [[raw[0][0], raw[0][1], 0]]; let cum = 0, prev = raw[0];
    for(let i=1;i<raw.length;i++){
      cum += hav(prev, raw[i]) / 1000; prev = raw[i];
      const lastKept = pts[pts.length-1];
      if(i===raw.length-1 || cum - lastKept[2] >= 0.015) pts.push([+raw[i][0].toFixed(6), +raw[i][1].toFixed(6), +cum.toFixed(4)]);
    }
    return {name:nm, total:+cum.toFixed(3), pts};
  }catch(e){ return null; }
}

/* ---------- イベント ---------- */
document.addEventListener("click", e=>{
  if(e.target.closest("[data-act='runmode']")){ openRun(); return; }
  const b = e.target.closest("[data-rm]"); if(!b) return;
  const a = b.dataset.rm;
  if(a==="close") closeRun();
  if(a==="setup") openRunSetup();
  if(a==="start") startRun(false);
  if(a==="demo") startRun(true);
  if(a==="pause") pauseRun();
  if(a==="resume") resumeRun();
  if(a==="speak") say(R ? statusText() : "計測していません。スタートを押してください。", true);
  if(a==="finish"){ if(finishArmed) finishRun(); else { finishArmed = true; buildRun(); setTimeout(()=>{ if(finishArmed){ finishArmed = false; buildRun(); } }, 4000); } }
  if(a==="fix"){
    document.getElementById("rmFix").innerHTML = `<form class="rm-card" id="rmFixForm"><label class="field"><span>いまの正しい距離（km）。km表示の看板を通過したときに入力</span><input class="inp" id="rmFixKm" type="number" inputmode="decimal" step="0.01" value="${dist().toFixed(2)}"></label><div class="row"><button class="rm-btn go" type="submit">補正する</button><button class="rm-btn ghost" type="button" data-rm="fixclose">やめる</button></div></form>`;
  }
  if(a==="fixclose") document.getElementById("rmFix").innerHTML = "";
}, true);
document.addEventListener("submit", e=>{
  if(e.target.id!=="rmFixForm") return;
  e.preventDefault();
  const v = Number(document.getElementById("rmFixKm").value);
  if(R && v >= 0){ R.off += v - dist(); while(R.nextKm <= v) R.nextKm++; persistRun(); document.getElementById("rmFix").innerHTML = ""; toast("距離を補正しました"); updateRun(); }
});
document.addEventListener("visibilitychange", ()=>{
  if(!R) return;
  if(document.hidden){ persistRun(); return; }
  keepAwake();
  if(!R.pauseAt && !R.demo){ wantStatus = true; setTimeout(()=>{ if(wantStatus && R){ wantStatus = false; say(statusText(), true); } }, 6000); }
});

/* 通常画面に出す入口 */
function runCard(){
  return `<section class="panel run-entry">
    <div class="spread"><div><span class="label">実践モード</span><h3>${R ? (R.pauseAt ? "一時停止中" : "計測中") + " " + dist().toFixed(2) + "km" : "GPSで走る"}</h3></div>
    <button class="btn primary" data-act="runmode">${R ? "計測画面に戻る" : "開く"}</button></div>
    ${R ? "" : `<p class="small muted">距離・ラップ・目標ペースとの差・関門までの必要ペースを音声で案内します。</p>`}
  </section>`;
}

loadRun(); loadCourse(); runCfg();
if(R && R.demo){ R = null; persistRun(); }
if(R){ startGps(); startTick(); }
if(location.hash === "#run") openRun(); else render();

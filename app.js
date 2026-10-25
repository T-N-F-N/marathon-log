"use strict";
/* ===== 42.195 Log：プラン・記録・アドバイス・共有 ===== */
const KEY = "marathon-log-v1";
const WD = ["日","月","火","水","木","金","土"];
const TYPES = {
  rest:  {label:"休養",       c:"--t-rest"},
  jog:   {label:"ジョグ",     c:"--t-jog"},
  point: {label:"ポイント練", c:"--t-point"},
  long:  {label:"ロング走",   c:"--t-long"},
  tune:  {label:"刺激入れ",   c:"--t-tune"},
  race:  {label:"レース",     c:"--t-race"},
  other: {label:"その他",     c:"--t-rest"}
};
const HARD = new Set(["point","long","race"]);

// Default 3-week taper. `o` = days before race day (negative), so the plan follows any race date.
const TEMPLATE = [
  {o:-20,t:"rest", km:0,  title:"完全休養",        detail:"ストレッチ・睡眠をしっかり"},
  {o:-19,t:"jog",  km:8,  title:"ジョグ 8km",      detail:"会話できるペース（目標ペース+60〜90秒/km）"},
  {o:-18,t:"point",km:10, title:"ペース走 10km",   detail:"W-up 2km → レースペース 4km×2（間 1km ジョグ）"},
  {o:-17,t:"jog",  km:6,  title:"ジョグ 6km",      detail:"リラックスして"},
  {o:-16,t:"rest", km:0,  title:"休養",            detail:"翌日のロング走に備える"},
  {o:-15,t:"long", km:22, title:"ロング走 22km",   detail:"最後の長い距離。目標ペース+30秒/km。補給の練習（ジェルを1〜2個）も兼ねる"},
  {o:-14,t:"jog",  km:6,  title:"リカバリー 6km",  detail:"ごくゆっくり。脚の張りを確認"},
  {o:-13,t:"rest", km:0,  title:"休養",            detail:""},
  {o:-12,t:"jog",  km:8,  title:"ジョグ 8km + 流し", detail:"最後に100m×4本の流し"},
  {o:-11,t:"point",km:8,  title:"レースペース走 8km", detail:"W-up 2km → レースペース 3km×2"},
  {o:-10,t:"jog",  km:6,  title:"ジョグ 6km",      detail:""},
  {o:-9, t:"rest", km:0,  title:"休養",            detail:""},
  {o:-8, t:"long", km:15, title:"中距離走 15km",   detail:"10kmをゆっくり → 最後の5kmをレースペース。シューズ・ウェアは本番と同じもので"},
  {o:-7, t:"jog",  km:6,  title:"ジョグ 6km",      detail:"1週間前。ここからは疲労を抜く期間"},
  {o:-6, t:"rest", km:0,  title:"休養",            detail:""},
  {o:-5, t:"jog",  km:6,  title:"ジョグ 6km + 流し", detail:"100m×4本"},
  {o:-4, t:"tune", km:5,  title:"刺激入れ 5km",    detail:"ジョグの中にレースペース 2km。息が上がりすぎない程度"},
  {o:-3, t:"rest", km:0,  title:"休養（またはジョグ 3km）", detail:"カーボローディング開始"},
  {o:-2, t:"jog",  km:4,  title:"ジョグ 4km",      detail:"短く軽く。脚を動かすだけ"},
  {o:-1, t:"tune", km:3,  title:"刺激 3km + 流し", detail:"ジョグ 2km + レースペース 1km。持ち物を準備して早めに寝る"},
  {o:0,  t:"race", km:42.195, title:"レース当日",  detail:"前半は目標ペースより抑えめに。5kmごとに給水、ジェルは30〜40分ごと"}
];

/* ---------- date helpers (local time, YYYY-MM-DD) ---------- */
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parseYmd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d = parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); };
const diffDays = (a,b) => Math.round((parseYmd(a)-parseYmd(b))/864e5);
const todayStr = () => ymd(new Date());
const md = s => { const d = parseYmd(s); return (d.getMonth()+1)+"/"+d.getDate(); };
const wd = s => parseYmd(s).getDay();
const mondayOf = s => addDays(s, -((wd(s)+6)%7));

/* ---------- time helpers ---------- */
// 数字だけの入力も受け付ける：「5830」→58:30、「14530」→1:45:30、「541」→5:41、「45」→45:00
function normTime(str){
  let s = String(str??"").trim().replace(/[：．。.・,，]/g,":");
  if(!s) return "";
  if(/^\d+$/.test(s)){
    if(s.length<=2) return Number(s)+":00";
    const sec = s.slice(-2), min = s.slice(-4,-2), h = s.slice(0,-4);
    return h ? Number(h)+":"+min+":"+sec : Number(min)+":"+sec;
  }
  return s;
}
function parseTime(str){
  const s = normTime(str);
  if(!s) return null;
  const p = s.split(":").map(Number);
  if(p.some(isNaN)) return null;
  if(p.length===3) return p[0]*3600+p[1]*60+p[2];
  if(p.length===2) return p[0]*60+p[1];
  return null;
}
function fmtTime(sec){
  if(sec==null||!isFinite(sec)) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  return h ? h+":"+pad(m)+":"+pad(s) : m+":"+pad(s);
}
const fmtKm = n => (Math.round(n*10)/10).toLocaleString("ja-JP",{maximumFractionDigits:1});
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nl2br = s => esc(s).replace(/\n/g,"<br>");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
// 時刻の入力欄は、入力を終えたときに「58:30」の形にそろえる
document.addEventListener("focusout", e=>{ if(e.target.matches && e.target.matches(".t-in")){ const v = normTime(e.target.value); if(v!==e.target.value){ e.target.value = v; e.target.dispatchEvent(new Event("input",{bubbles:true})); } } });

/* ---------- state ---------- */
// 端末内（localStorage）に保存し、共有を設定していればスプレッドシートとも同期する。
// 同期は「日付ごとの予定・記録・コメント」「設定」「アドバイス」などの単位で、あとから変更された方を残す（S.meta に変更時刻）。
const MAP_KEYS = ["plan","logs","comments","trash"];
const TOP_KEYS = ["settings","run","registered","advice","checks","admin"];
function freshState(){
  return {v:2, settings:{raceName:"神戸マラソン2026", raceDate:"2026-11-15", goal:"4:00:00", weight:60}, plan:{}, logs:{}, comments:{}, trash:{}, registered:false, meta:{}};
}
let S = freshState();
let storageOk = true;
let lastUnits = {};
function migrateLog(l){
  if(!l || l.runs) return l;
  const r = {};
  ["km","time","laps","route","gps"].forEach(k=>{ if(l[k]!==undefined){ if(l[k]!=="" && l[k]!=null) r[k] = l[k]; delete l[k]; } });
  l.runs = (r.km!==undefined || r.time || r.laps) ? [Object.assign({id:"r1"}, r)] : [];
  return l;
}
function normalize(d){
  const s = Object.assign(freshState(), d, {settings:Object.assign(freshState().settings, d.settings||{}), plan:d.plan||{}, logs:d.logs||{}, comments:d.comments||{}, trash:d.trash||{}, meta:d.meta||{}});
  Object.values(s.logs).forEach(migrateLog);
  return s;
}
function units(st){
  const u = {};
  MAP_KEYS.forEach(m=>Object.keys(st[m]||{}).forEach(k=>u[m+"/"+k] = st[m][k]));
  TOP_KEYS.forEach(k=>{ if(st[k]!==undefined) u[k] = st[k]; });
  return u;
}
function unitStrings(st){ const u = units(st), o = {}; Object.keys(u).forEach(k=>o[k] = JSON.stringify(u[k])); return o; }
function mergeStates(a, b){
  const ua = units(a), ub = units(b), ma = a.meta||{}, mb = b.meta||{};
  const keys = new Set([...Object.keys(ua), ...Object.keys(ub), ...Object.keys(ma), ...Object.keys(mb)]);
  const res = {v:2, settings:a.settings||b.settings, plan:{}, logs:{}, comments:{}, trash:{}, registered:false, meta:{}};
  keys.forEach(k=>{
    const ta = ma[k]||0, tb = mb[k]||0;
    const v = (tb > ta || (tb===ta && !(k in ua))) ? ub[k] : ua[k];
    res.meta[k] = Math.max(ta, tb);
    if(v===undefined) return;
    const i = k.indexOf("/");
    if(i>0 && MAP_KEYS.includes(k.slice(0,i))) res[k.slice(0,i)][k.slice(i+1)] = v;
    else res[k] = v;
  });
  return normalize(res);
}
function stamp(all){
  const cur = unitStrings(S), t = Date.now();
  S.meta = S.meta || {};
  new Set([...Object.keys(cur), ...Object.keys(lastUnits)]).forEach(k=>{
    if(all || cur[k]!==lastUnits[k]){ S.meta[k] = t; Seen.mark(k, t); }   // 自分の変更は「新着」にしない
  });
  lastUnits = cur;
}
function persistLocal(){
  try{ localStorage.setItem(KEY, JSON.stringify(S)); storageOk = true; }catch(e){ storageOk = false; }
  renderSaveState();
}
function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw) S = normalize(JSON.parse(raw));
  }catch(e){ storageOk = false; }
  lastUnits = unitStrings(S);
}
function save(){ stamp(); persistLocal(); Sync.schedule(); }

/* ---------- ゴミ箱（30日間は元に戻せる。共有中は2人とも見られる） ---------- */
const TRASH_DAYS = 30;
const clone = o => o===undefined ? undefined : JSON.parse(JSON.stringify(o));
function toTrash(kind, date, data, extra){
  const id = uid();
  S.trash[id] = Object.assign({kind, date:date||null, data:clone(data), at:Date.now()}, extra||{});
  return id;
}
function snapshotAll(){
  const o = {};
  ["settings","plan","logs","comments","advice","checks","registered","run"].forEach(k=>{ if(S[k]!==undefined) o[k] = clone(S[k]); });
  return o;
}
function purgeTrash(){
  const lim = Date.now() - TRASH_DAYS*864e5; let ch = false;
  Object.keys(S.trash).forEach(id=>{ if((S.trash[id].at||0) < lim){ delete S.trash[id]; ch = true; } });
  return ch;
}
function trashLabel(t){
  const d = t.date ? `${md(t.date)}（${WD[wd(t.date)]}）` : "";
  const r = t.data || {};
  switch(t.kind){
    case "plan":    return `${d} の予定「${r.title||""}」`;
    case "log":     return `${d} の記録（${runsLine(r) || "メモなど"}）`;
    case "run":     return `${d} の記録 1回分（${r.km!=="" && r.km!=null ? fmtKm(r.km)+"km" : "—"}${r.time ? "・"+r.time : ""}${r.gps ? "・GPS" : ""}）`;
    case "comment": return `${d} の管理者コメント「${String(r.text||"").slice(0,20)}${String(r.text||"").length>20?"…":""}」`;
    case "plans":   return `プラン全体（${Object.keys(r).length}日分）`;
    case "advice":  return `アドバイス「${(ADVICE_SECTIONS.find(s=>s.id===t.sec)||{}).title||""}」`;
    case "all":     return t.before==="restore" ? "すべてのデータ（ゴミ箱から復旧する前の状態）" : "すべてのデータ（消去する前の状態）";
  }
  return "データ";
}
function restoreTrash(id){
  const t = S.trash[id]; if(!t) return;
  const v = clone(t.data);
  switch(t.kind){
    case "plan": ensureRegistered(); if(S.plan[t.date]) toTrash("plan", t.date, S.plan[t.date]); S.plan[t.date] = v; break;
    case "log": {
      const cur = S.logs[t.date];
      if(!cur){ S.logs[t.date] = migrateLog(v); break; }
      const ids = new Set(runsOf(cur).map(r=>r.id));
      cur.runs = [...runsOf(cur), ...runsOf(v).filter(r=>!ids.has(r.id))].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      ["status","rpe","cond","sleep","weight","meal","memo"].forEach(k=>{ if(!cur[k] && v[k]) cur[k] = v[k]; });
      break;
    }
    case "run": {
      const cur = S.logs[t.date] || {status:"", runs:[]}; migrateLog(cur);
      if(!runsOf(cur).some(r=>r.id===v.id)) cur.runs.push(v);
      cur.runs.sort((a,b)=>String(a.id).localeCompare(String(b.id)));   // 1回目・2回目の順に戻す
      S.logs[t.date] = cur; break;
    }
    case "comment": if(S.comments[t.date]) toTrash("comment", t.date, S.comments[t.date]); S.comments[t.date] = v; break;
    case "plans": toTrash("plans", null, S.plan); S.plan = v; S.registered = true; break;
    case "advice": { const a = clone(advice()); a.sections = a.sections||{}; if(a.sections[t.sec]) toTrash("advice", null, a.sections[t.sec], {sec:t.sec}); a.sections[t.sec] = v; S.advice = a; break; }
    case "all":   // 今の状態に予定や記録があれば、それもゴミ箱に残してから戻す
      if(Object.keys(S.plan).length || Object.keys(S.logs).length || Object.keys(S.comments).length) toTrash("all", null, snapshotAll(), {before:"restore"});
      Object.assign(S, v); break;
  }
  delete S.trash[id];
  save();
}

/* ---------- 既読（この端末で見たかどうか） ---------- */
const Seen = {
  KEY:"marathon-seen-v1", d:null,
  get(){ if(!this.d){ try{ this.d = JSON.parse(localStorage.getItem(this.KEY)||"{}"); }catch(e){ this.d = {}; } } return this.d; },
  put(){ try{ localStorage.setItem(this.KEY, JSON.stringify(this.d)); }catch(e){} },
  mark(k, t){ this.get()[k] = Math.max(this.get()[k]||0, t||Date.now()); this.put(); },
  isNew(k){ const t = (S.meta||{})[k]; return !!t && t > (this.get()[k]||0) && (k!=="advice" || hasAdvice()) && (!k.startsWith("comments/") || !!S.comments[k.slice(9)]); }
};
const newComments = () => Object.keys(S.comments).filter(d=>Seen.isNew("comments/"+d)).sort();

/* ---------- 管理者モード（この端末だけ） ---------- */
const Admin = {
  KEY:"marathon-admin-v1",
  on(){ try{ return localStorage.getItem(this.KEY)==="1"; }catch(e){ return false; } },
  set(v){ try{ v ? localStorage.setItem(this.KEY,"1") : localStorage.removeItem(this.KEY); }catch(e){} },
  async hash(pin){
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("42195:"+pin));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
  }
};

/* ---------- スプレッドシートとの同期 ---------- */
const SYNC_KEY = "marathon-sync-v1";
const Sync = {
  cfg:null, state:"off", lastAt:0, timer:null, busy:false, again:false,
  loadCfg(){
    try{ this.cfg = JSON.parse(localStorage.getItem(SYNC_KEY)||"null"); }catch(e){ this.cfg = null; }
    const q = new URLSearchParams(location.search);   // ランナー用リンク ?s=URL&k=合言葉
    if(q.get("s") && q.get("k") && (!this.cfg || this.cfg.url!==q.get("s") || this.cfg.key!==q.get("k"))){
      this.cfg = {url:q.get("s"), key:q.get("k"), fresh:true}; this.saveCfg();
    }
    this.state = this.cfg ? "idle" : "off";
  },
  saveCfg(){ try{ this.cfg ? localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg)) : localStorage.removeItem(SYNC_KEY); }catch(e){} },
  // openExternalBrowser=1：LINEでタップしてもLINEの中ではなく、Safari／Chromeで開く
  link(){ return this.cfg ? location.origin + location.pathname + "?s=" + encodeURIComponent(this.cfg.url) + "&k=" + encodeURIComponent(this.cfg.key) + "&openExternalBrowser=1" : ""; },
  async post(body){
    const r = await fetch(this.cfg.url, {method:"POST", body:JSON.stringify(Object.assign({key:this.cfg.key}, body))});
    const j = await r.json();
    if(!j.ok) throw new Error(j.error==="key" ? "合言葉が違います" : "スプレッドシートでエラーが起きました");
    return j;
  },
  async call(body){
    if(body) return (await this.post(body)).state;
    const r = await fetch(this.cfg.url + (this.cfg.url.includes("?")?"&":"?") + "action=get&key=" + encodeURIComponent(this.cfg.key) + "&t=" + Date.now());
    const j = await r.json();
    if(!j.ok) throw new Error(j.error==="key" ? "合言葉が違います" : "スプレッドシートでエラーが起きました");
    return j.state;
  },
  adopt(remote){
    if(!remote) return;
    const before = JSON.stringify(units(S));
    S = mergeStates(S, normalize(remote));
    lastUnits = unitStrings(S);
    persistLocal();
    if(JSON.stringify(units(S))!==before && !document.querySelector(".sheet-bg") && !editingInline()) render();
  },
  schedule(){ if(!this.cfg) return; this.pending = true; this.set("pending"); clearTimeout(this.timer); this.timer = setTimeout(()=>this.run(), 1500); },
  async run(){
    if(!this.cfg) return;
    if(this.busy){ this.again = true; return; }
    if(!navigator.onLine){ this.set(this.pending ? "pending" : "offline"); return; }
    this.busy = true;
    let sending = false;
    try{
      if(this.cfg.fresh){   // この端末で初めて接続：先に共有データを取り込み、端末の記録も送る
        this.adopt(await this.call()); stamp(true); persistLocal();
        this.cfg.fresh = false; this.saveCfg(); this.pending = true;
      }
      sending = this.pending; this.pending = false;
      this.adopt(sending ? await this.call({state:S}) : await this.call());
      this.lastAt = Date.now(); this.err = ""; this.set(this.pending ? "pending" : "ok");
    }catch(e){ if(sending) this.pending = true; this.err = e.message || "通信できませんでした"; this.set("error"); }
    this.busy = false;
    if(this.again){ this.again = false; this.run(); }
  },
  set(st){ this.state = st; renderSaveState(); }
};
function renderSaveState(){
  const el = document.getElementById("saveState");
  if(!el) return;
  if(!storageOk){ el.textContent = "保存できません（プライベートモード？）"; return; }
  el.textContent = syncLabel();
  el.dataset.state = Sync.state;
}
function syncLabel(){
  const t = Sync.lastAt ? new Date(Sync.lastAt) : null;
  return {
    off:"この端末に自動保存", idle:"同期の準備中…",
    ok:"共有済み " + (t ? t.getHours()+":"+pad(t.getMinutes()) : ""),
    pending:"未送信あり", offline:"オフライン",
    error:"同期できません（設定を確認）"
  }[Sync.state] || "";
}
const editingInline = () => !!document.querySelector("[data-editing]");
if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(()=>{}); }

function templatePlan(){
  const out = {};
  TEMPLATE.forEach(x=>{ out[addDays(S.settings.raceDate, x.o)] = {t:x.t, km:x.km, title:x.title, detail:x.detail}; });
  return out;
}
const activePlan = () => S.registered ? S.plan : templatePlan();
function ensureRegistered(){ if(!S.registered){ S.plan = templatePlan(); S.registered = true; } }

/* ---------- 記録の集計（1日に複数回の記録） ---------- */
const runsOf = l => (l && l.runs) || [];
const logKm = l => runsOf(l).reduce((s,r)=>s+(Number(r.km)||0), 0);
const logSec = l => runsOf(l).reduce((s,r)=>s+(parseTime(r.time)||0), 0);
const hasRunData = l => runsOf(l).some(r=>(r.km!=="" && r.km!=null) || r.time);
function autoStatus(date){
  const p = activePlan()[date], km = logKm(S.logs[date]);
  return p && p.km ? (km >= p.km*0.9 ? "done" : "part") : "done";
}

/* ---------- derived ---------- */
function status(date){
  const p = activePlan()[date], l = S.logs[date];
  if(l && l.status) return l.status;
  if(l && hasRunData(l)) return autoStatus(date);
  if(date < todayStr() && p && p.t!=="rest") return "miss";
  return null;
}
const ST_LABEL = {done:"完了", part:"一部", miss:"未実施", skip:"休み"};
function stBadge(date){
  const s = status(date);
  if(!s) return "";
  const cls = s==="done"?"st-done":s==="part"?"st-part":s==="miss"?"st-miss":"st-todo";
  return `<span class="st ${cls}">${ST_LABEL[s]}</span>`;
}
function phaseOf(date){
  const o = diffDays(date, S.settings.raceDate);
  if(o>0) return "after";
  if(o===0) return "race";
  if(o===-1) return "eve";
  if(o>=-3) return "load";
  if(o>=-7) return "week";
  return "base";
}
const goalSec = () => parseTime(S.settings.goal);
const goalPace = () => { const g = goalSec(); return g ? g/42.195 : null; };

function planDates(){
  const set = new Set([...Object.keys(activePlan()), ...Object.keys(S.logs)]);
  return [...set].sort();
}
function weekGroups(){
  const g = {};
  planDates().forEach(d=>{ const m = mondayOf(d); (g[m]=g[m]||[]).push(d); });
  return Object.keys(g).sort().map(m=>({mon:m, days:g[m]}));
}
function weekTotals(days){
  const plan = activePlan(); let p=0,a=0;
  days.forEach(d=>{ p += Number(plan[d]?.km)||0; a += logKm(S.logs[d]); });
  return {p,a};
}
function overallStats(){
  const t = todayStr(), plan = activePlan(), dates = planDates();
  const pastRun = dates.filter(d=>d<=t && plan[d] && plan[d].t!=="rest" && !(d===t && !S.logs[d]));
  const done = pastRun.filter(d=>["done","part"].includes(status(d))).length;
  const totalKm = dates.reduce((s,d)=>s+logKm(S.logs[d]),0);
  let streak = 0, d = S.logs[t] ? t : addDays(t,-1);
  while(true){
    const s = status(d), p = plan[d];
    if(S.logs[d] && s!=="miss") streak++;
    else if(p && p.t==="rest" && d < t){ /* 休養日は連続を切らない */ }
    else break;
    d = addDays(d,-1);
    if(streak > 400) break;
  }
  return {totalKm, rate: pastRun.length ? Math.round(done/pastRun.length*100) : null, streak};
}
function planWarnings(date){
  const plan = activePlan(), p = plan[date], o = diffDays(date, S.settings.raceDate);
  if(!p || !HARD.has(p.t) || p.t==="race") return "";
  if(o<0 && o>=-3) return "レース直前に強い練習が入っています";
  const prev = plan[addDays(date,-1)];
  if(prev && HARD.has(prev.t) && prev.t!=="race") return "強い練習が2日続いています";
  return "";
}

/* ---------- アドバイス ---------- */
const ADVICE_SECTIONS = [
  {id:"cheer",   title:"ひとこと",                 hint:"ホーム画面に大きく表示されます。応援のひとことなど", phases:[]},
  {id:"week",    title:"1週間前からの過ごし方",     hint:"睡眠・仕事・練習量・体調管理など", phases:["week","load"]},
  {id:"eve",     title:"前日",                     hint:"夕食・持ち物・寝る時間など", phases:["eve"]},
  {id:"morning", title:"当日の朝・食事",           hint:"起きる時間・朝食・会場への移動など", phases:["race"]},
  {id:"race",    title:"レース中の注意点",          hint:"ペース配分・給水・補給・苦しいときの対処など（本番スタート時に読み上げます）", phases:["race"]},
  {id:"after",   title:"レース後",                 hint:"ゴール後の補給・回復など", phases:["after"]},
  {id:"free",    title:"いつでも見てほしいこと",     hint:"練習期間中に意識してほしいこと", phases:["base"]}
];
const DEFAULT_CHECKLIST = ["ナンバーカード・計測チップ","シューズ（履き慣れたもの）","ウェア・帽子・手袋","ジェル・補給食","ワセリン・テーピング・絆創膏","着替え・タオル","スマホ（充電済み）・イヤホンの可否確認","交通系ICカード・現金","雨具・防寒用のゴミ袋","参加案内（集合時間・ブロック）"];
const advice = () => S.advice || {sections:{}, checklist:null};
const checklist = () => advice().checklist || DEFAULT_CHECKLIST.map((t,i)=>({id:"d"+i, text:t}));
const hasAdvice = () => Object.values(advice().sections||{}).some(v=>v && v.trim());
function advForPhase(ph){ return ADVICE_SECTIONS.filter(s=>s.phases.includes(ph) && (advice().sections||{})[s.id]); }

/* ---------- 食事（一般的な目安） ---------- */
function foodPhases(){
  const w = Number(S.settings.weight)||60;
  const g = goalSec()||14400, hours = g/3600;
  return [
    {id:"base", pc:"--t-jog", when:"〜レース8日前", title:"いつもの食事を整える",
      tips:[
        "主食・主菜・副菜をそろえ、毎食しっかり食べる。急な減量は脚の回復を遅らせるので避ける",
        "ポイント練習・ロング走のあと30分以内に、糖質＋たんぱく質（おにぎり＋牛乳、バナナ＋ヨーグルトなど）",
        "鉄分を意識：赤身肉・レバー・あさり・小松菜。ビタミンC（果物）と一緒にとると吸収が上がる",
        "水分は練習前後にこまめに。尿の色が濃ければ不足のサイン",
        "ロング走では本番で使うジェル・ドリンクを試す。お腹に合うかを確認する"
      ]},
    {id:"week", pc:"--t-tune", when:"7〜4日前", title:"疲労を抜き、体調を崩さない",
      tips:[
        "練習量が減るので、食べる量は「いつも通り〜少し控えめ」でOK。体重が1kg程度増えるのは問題なし",
        "手洗い・うがい・睡眠で風邪予防。人混みではマスクも",
        "生もの（刺身・生がき・加熱不十分な肉）は食中毒のリスクがあるので控える",
        "アルコールはできるだけ控える。飲むなら少量で"
      ]},
    {id:"load", pc:"--t-long", when:"3〜2日前", title:"カーボローディング",
      tips:[
        `炭水化物を体重1kgあたり7〜10g/日。あなたの場合 <b>${Math.round(w*7)}〜${Math.round(w*10)}g/日</b>（ごはん茶碗1杯 約55g）`,
        "ごはん・うどん・パン・もち・カステラ・バナナ・100%ジュースなどで「主食を増やし、おかずの脂っこさを減らす」",
        "揚げ物・脂の多い肉・クリーム系は消化に時間がかかるので控えめに",
        "水分もいつもより多めに（糖質と一緒に体に水分がたまる）",
        "食べ慣れたものだけを食べる。新しい食品・サプリはこの時期に試さない"
      ]},
    {id:"eve", pc:"--t-point", when:"前日", title:"消化の良い糖質中心",
      tips:[
        "食物繊維の多いもの（ごぼう・きのこ・海藻・豆・玄米・生野菜の大盛り）は控える",
        "夕食は早めに、腹八分目。うどん・ごはん・餅・白身魚・卵など",
        "辛いもの・炭酸・乳製品でお腹がゆるくなりやすい人は避ける",
        "アルコールは飲まない。寝る前までにこまめに水分補給",
        "持ち物（ナンバーカード・シューズ・ジェル・ワセリン・テーピング）を前夜のうちに準備"
      ]},
    {id:"race", pc:"--t-race", when:"当日", title:"朝食と走りながらの補給",
      tips:[
        `朝食はスタート3〜4時間前に。炭水化物を体重1kgあたり2〜3g。あなたの場合 <b>${Math.round(w*2)}〜${Math.round(w*3)}g</b>（おにぎり2〜3個＋バナナ、もちなど）`,
        "スタート30〜60分前にジェル1個か、バナナ半分。水は200〜300ml程度",
        `走行中は1時間あたり炭水化物30〜60g。目標 ${fmtTime(g)} なら合計 <b>約${Math.round(hours*45)}g</b>、ジェル（約25g）で <b>${Math.max(3,Math.round(hours*45/25))}個前後</b> を30〜40分ごと`,
        "給水は喉が渇く前に、各給水所で少しずつ。一度に大量に飲まない（水の飲み過ぎは低ナトリウム血症の原因）",
        "気温が高い日はスポーツドリンクや塩タブレットで塩分も",
        "朝のコーヒーは普段から飲んでいる人だけ。トイレが近くなる人は量を控える"
      ]},
    {id:"after", pc:"--t-rest", when:"レース後", title:"回復",
      tips:[
        "ゴール後30分以内に糖質＋たんぱく質（スポーツドリンク、おにぎり、プロテインなど）",
        "その日の夜はしっかり食べて早めに寝る。お祝いのお酒は水分補給をしてから少量で",
        "1週間ほどは軽いジョグか休養。筋肉痛や痛みが残る場合は無理しない"
      ]}
  ];
}
const PHASE_NAME = {base:"練習期", week:"レース週", load:"カーボローディング", eve:"レース前日", race:"レース当日", after:"レース後"};
const MOTTO = {
  base:["積み上げた距離は、裏切らない。","今日の1kmが、30km地点の自分を助ける。","ロング走は本番の予行演習。補給も試そう。","速さより、続けること。","脚が重い日は、ゆっくりでいい。止まらなければ前に進む。"],
  week:["ここからは、休むのも練習。","疲れを抜いて、脚を研ぐ1週間。","よく眠った人が、スタートラインで強い。","やってきたことを信じよう。"],
  load:["食べることが、今日の練習。","炭水化物は、日曜のガソリン。","あとは整えるだけ。"],
  eve:["準備は整った。あとは楽しむだけ。","早めに寝よう。明日は神戸の海沿いを走る日。"],
  race:["行ってらっしゃい！ 前半は抑えて、30kmからが勝負。"],
  after:["完走、おめでとう。まずはゆっくり休もう。"]
};

/* ---------- views ---------- */
let tab = "today";
const app = document.getElementById("app");

function topBar(){
  const left = diffDays(S.settings.raceDate, todayStr());
  const inLine = / Line\//i.test(navigator.userAgent);
  return `
  ${inLine ? `<p class="note" style="border:1px solid var(--warn);color:var(--ink)"><b>LINEの中で開いています。</b>このままだと保存や共有の設定がLINEの中だけに残り、ホーム画面にも追加できません。右上のメニューから「ブラウザで開く」（または「他のアプリで開く」）を選んで、Safari／Chromeで開き直してください。</p>` : ""}
  <div class="top"><div class="brand">42.<span>195</span> Log${Admin.on()?` <span class="admin-chip">管理者</span>`:""}</div>
    <div class="top-right">${tab!=="today" && left>=0 ? `<span class="count-chip">あと<b class="num">${left}</b>日</span>` : ""}<span class="save-state" id="saveState"></span></div></div>`;
}

function hero(){
  const st = S.settings, t = todayStr(), left = diffDays(st.raceDate, t), ph = phaseOf(t);
  const gp = goalPace(), stats = overallStats();
  const dates = Object.keys(activePlan()).sort();
  const start = dates[0] || addDays(st.raceDate,-20);
  const total = Math.max(1, diffDays(st.raceDate, start));
  const prog = Math.min(1, Math.max(0, diffDays(t, start)/total));
  const cheer = (advice().sections||{}).cheer;
  const mottos = MOTTO[ph]; const motto = mottos[Math.abs(diffDays(t,"2026-01-01")) % mottos.length];
  const wDays = left>0 ? left : 0, weeks = Math.floor(wDays/7);
  let big, unit, lbl;
  if(left>0){ big = left; unit = "日"; lbl = "RACE DAY まで"; }
  else if(left===0){ big = "TODAY"; unit = ""; lbl = "いよいよ本番"; }
  else { big = -left; unit = "日"; lbl = "レースから"; }
  return `
  <section class="hero" aria-label="レースまでのカウントダウン">
    <div class="hero-band"><span class="hero-race">${esc(st.raceName)}</span><span class="num">${esc(st.raceDate.replace(/-/g,"."))} ${["SUN","MON","TUE","WED","THU","FRI","SAT"][wd(st.raceDate)]}</span></div>
    <div class="hero-main">
      <div class="hero-count">
        <span class="hero-lbl">${lbl}</span>
        <span class="hero-days${left===0?" is-today":""}">${big}<small>${unit}</small></span>
        ${left>0 ? `<span class="hero-sub">${weeks ? `あと${weeks}週間${wDays%7 ? "と"+(wDays%7)+"日" : ""}` : "ラストウィーク"}・${PHASE_NAME[ph]}</span>` : ""}
      </div>
      <div class="hero-goal">
        <span class="hero-lbl">GOAL</span>
        <b class="num">${esc(st.goal||"—")}</b>
        <span class="num">${gp?fmtTime(gp):"—"}<small>/km</small></span>
      </div>
    </div>
    <div class="hero-journey">
      <svg viewBox="0 0 320 64" class="journey" aria-hidden="true">
        <path id="jPath" d="M10 46 C 46 46, 52 18, 92 22 S 140 52, 178 40 S 236 10, 270 20 S 302 34, 310 30" fill="none" stroke="var(--hero-line)" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 9"/>
        <path id="jDone" d="M10 46 C 46 46, 52 18, 92 22 S 140 52, 178 40 S 236 10, 270 20 S 302 34, 310 30" fill="none" stroke="var(--hero-accent)" stroke-width="4" stroke-linecap="round"/>
        <g transform="translate(310 30)"><line x1="0" y1="0" x2="0" y2="-24" stroke="var(--hero-ink)" stroke-width="2"/><path d="M0 -24 L16 -19 L0 -14 Z" fill="var(--hero-accent)"/></g>
        <circle id="jDot" cx="10" cy="46" r="7" fill="var(--hero-accent)" stroke="var(--hero-bg1)" stroke-width="3"/>
      </svg>
      <div class="journey-lbl"><span>${md(start)} 練習スタート</span><span>${Math.round(prog*100)}%</span><span>GOAL ${md(st.raceDate)}</span></div>
    </div>
    <p class="hero-msg">${cheer ? `<span class="hero-from">コーチより</span>${nl2br(cheer)}` : esc(motto)}</p>
    <div class="hero-stats">
      <div><b class="num">${fmtKm(stats.totalKm)}</b><span>累計km</span></div>
      <div><b class="num">${stats.rate==null?"—":stats.rate+"%"}</b><span>実施率</span></div>
      <div><b class="num">${stats.streak}</b><span>連続日数</span></div>
    </div>
  </section>`;
}
function placeJourney(){
  const p = document.getElementById("jPath"), done = document.getElementById("jDone"), dot = document.getElementById("jDot");
  if(!p || !p.getTotalLength) return;
  const st = S.settings, dates = Object.keys(activePlan()).sort(), start = dates[0] || addDays(st.raceDate,-20);
  const prog = Math.min(1, Math.max(0, diffDays(todayStr(), start)/Math.max(1, diffDays(st.raceDate, start))));
  const L = p.getTotalLength(), pt = p.getPointAtLength(L*prog);
  done.setAttribute("stroke-dasharray", `${L*prog} ${L}`);
  dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y);
}

function runsLine(l){
  const rs = runsOf(l).filter(r=>(r.km!=="" && r.km!=null) || r.time);
  if(!rs.length) return "";
  const km = logKm(l), sec = logSec(l);
  return `${fmtKm(km)}km${sec?"・"+fmtTime(sec):""}${km&&sec?"（"+fmtTime(sec/km)+"/km）":""}${rs.length>1?`・${rs.length}回`:""}`;
}

function dayRow(date){
  const p = activePlan()[date] || {t:"other",km:0,title:"予定なし",detail:""};
  const l = S.logs[date];
  const ty = TYPES[p.t]||TYPES.other, w = wd(date);
  const akm = logKm(l);
  const km = l && hasRunData(l) ? `<span class="day-km">${fmtKm(akm)}<small class="muted"> / ${fmtKm(p.km)}km</small></span>`
           : p.km ? `<span class="day-km">${fmtKm(p.km)}<small class="muted">km</small></span>` : "";
  const cls = date===todayStr()?" is-today":date<todayStr()?" is-past":"";
  const warn = planWarnings(date);
  const cm = S.comments[date];
  return `<button class="day${cls}" data-day="${date}">
    <span class="day-date"><span class="d">${parseYmd(date).getDate()}</span><span class="w ${w===0?"sun":w===6?"sat":""}">${(parseYmd(date).getMonth()+1)}月・${WD[w]}</span></span>
    <span class="day-body"><span class="row" style="gap:6px"><span class="chip" style="--c:var(${ty.c})">${ty.label}</span>${cm?`<span class="cm-chip${Seen.isNew("comments/"+date)?" is-new":""}">コメント</span>`:""}</span>
      <span class="day-title">${esc(p.title)}</span>${p.detail?`<span class="day-detail">${esc(p.detail)}</span>`:""}${warn?`<span class="day-warn">⚠ ${warn}</span>`:""}</span>
    <span class="day-side">${km}${stBadge(date)}</span>
  </button>`;
}

function viewToday(){
  const t = todayStr(), plan = activePlan(), p = plan[t], l = S.logs[t];
  const ph = phaseOf(t), fp = foodPhases().find(x=>x.id===ph);
  const wk = weekGroups().find(w=>w.mon===mondayOf(t));
  const tot = wk ? weekTotals(wk.days) : {p:0,a:0};
  const next = planDates().filter(d=>d>t && plan[d] && plan[d].t!=="rest").slice(0,1)[0];
  const ty = p ? (TYPES[p.t]||TYPES.other) : null;
  const nc = newComments();
  const adv = advForPhase(ph);
  const advNew = Seen.isNew("advice");
  return `
  ${hero()}
  ${!S.registered ? `<section class="panel" style="border-color:var(--accent)">
    <h2>まずは練習プランを登録しましょう</h2>
    <p class="small muted">レース日から逆算した3週間の調整プラン（おすすめ）が入っています。内容を確認し、必要に応じて「プラン」タブで日ごとに編集できます。</p>
    <div class="row"><button class="btn primary" data-act="register">このプランで登録する</button><button class="btn ghost" data-go="plan">内容を見る</button></div>
  </section>`:""}
  ${nc.length ? `<section class="panel cm-panel">
    <div class="spread"><span class="label">管理者からの新しいコメント</span><span class="new-dot">NEW</span></div>
    ${nc.map(d=>`<button class="cm-item" data-day="${d}"><b>${md(d)}（${WD[wd(d)]}）</b><span>${esc(S.comments[d].text).slice(0,80)}${S.comments[d].text.length>80?"…":""}</span></button>`).join("")}
  </section>` : ""}
  ${Admin.on() ? `<section class="panel admin-panel">
    <div class="spread"><div><span class="label">管理者</span><h3>ランナーを見守る</h3></div><button class="btn primary" data-act="watch">見守り画面</button></div>
    <p class="small muted">走っている間の現在地・ペース・ラップを確認し、音声でメッセージを送れます。</p>
  </section>` : ""}
  <section class="panel">
    <div class="spread"><span class="label">今日 ${md(t)}（${WD[wd(t)]}）</span>${stBadge(t)}</div>
    ${p ? `<div class="today-main">
        <span><span class="chip" style="--c:var(${ty.c})">${ty.label}</span></span>
        <h2>${esc(p.title)}</h2>
        ${p.km?`<div class="big-dist">${fmtKm(p.km)}<small>km</small></div>`:""}
        ${p.detail?`<p class="small muted">${esc(p.detail)}</p>`:""}
      </div>`
      : `<p class="muted">今日の予定は登録されていません。</p>`}
    ${l && runsLine(l) ? `<div class="note">実績：${runsLine(l)}${l.rpe?"　きつさ "+esc(l.rpe)+"/10":""}</div>`:""}
    ${S.comments[t] ? `<div class="cm-box"><span class="label">管理者より</span><p>${nl2br(S.comments[t].text)}</p></div>` : ""}
    <div class="row"><button class="btn primary" style="flex:1" data-day="${t}">${l?"記録を見る・追加":"今日の練習を記録する"}</button>${typeof runEntryButton==="function" ? runEntryButton() : ""}</div>
  </section>
  ${adv.length ? `<section class="panel adv-panel">
    <div class="spread"><span class="label">今日見てほしいこと</span>${advNew?`<span class="new-dot">NEW</span>`:""}</div>
    ${adv.map(s=>`<div class="adv-mini"><h3>${s.title}</h3><p class="small">${nl2br(advice().sections[s.id])}</p></div>`).join("")}
    <button class="btn ghost" data-go="advice">アドバイスをすべて見る</button>
  </section>` : advNew ? `<section class="panel adv-panel"><div class="spread"><span class="label">管理者からのアドバイスが更新されました</span><span class="new-dot">NEW</span></div><button class="btn ghost" data-go="advice">アドバイスを見る</button></section>` : ""}

  <section class="panel">
    <div class="spread"><span class="label">今週の走行距離</span><span class="num" style="font-size:1.15rem;font-weight:600">${fmtKm(tot.a)} / ${fmtKm(tot.p)} km</span></div>
    <div class="bar"><i style="width:${tot.p?Math.min(100,tot.a/tot.p*100):0}%"></i></div>
    ${next?`<p class="small muted">次の練習：${md(next)}（${WD[wd(next)]}） ${esc(plan[next].title)}</p>`:""}
  </section>

  ${fp?`<section class="panel">
    <div class="spread"><span class="label">今日の食事ポイント</span><span class="chip" style="--c:var(${fp.pc})">${PHASE_NAME[ph]}</span></div>
    <h3>${fp.title}</h3>
    <ul class="tip-list small">${fp.tips.slice(0,3).map(x=>`<li>${x}</li>`).join("")}</ul>
    <button class="btn ghost" data-go="advice">食事の注意点をすべて見る</button>
  </section>`:""}`;
}

function viewPlan(){
  const groups = weekGroups();
  return `
  <div class="spread"><h2>練習プラン</h2><button class="btn" data-act="addday">＋ 日を追加</button></div>
  ${!S.registered?`<div class="note">これはおすすめプランです（まだ登録されていません）。「このプランで登録する」を押すか、日をタップして編集すると登録されます。<div style="margin-top:8px"><button class="btn primary" data-act="register">このプランで登録する</button></div></div>`
    :`<p class="small muted">日をタップすると、予定の変更・入れ替え・実績の記録ができます。</p>`}
  ${groups.map(g=>{ const t = weekTotals(g.days); return `
    <section class="week">
      <div class="week-head"><h3>${md(g.mon)}〜${md(addDays(g.mon,6))}の週</h3><span class="small muted num">予定 ${fmtKm(t.p)}km・実績 ${fmtKm(t.a)}km</span></div>
      ${g.days.map(dayRow).join("")}
    </section>`;}).join("")}`;
}

function viewLog(){
  const plan = activePlan();
  const dates = planDates();
  const logged = dates.filter(d=>S.logs[d] || S.comments[d]);
  const stats = overallStats();
  const groups = weekGroups();
  const maxV = Math.max(1,...groups.map(g=>{const x=weekTotals(g.days);return Math.max(x.p,x.a);}));
  const W=320,H=150,pl=30,pb=26,pt=10, bw=(W-pl-10)/Math.max(1,groups.length);
  const y = v => pt+(H-pt-pb)*(1-v/maxV);
  const step = maxV>60?20:maxV>30?10:5;
  let ticks=""; for(let v=0; v<=maxV; v+=step){ ticks+=`<line x1="${pl}" x2="${W-6}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pl-5}" y="${y(v)+4}" text-anchor="end" font-size="10" fill="var(--muted)">${v}</text>`; }
  const bars = groups.map((g,i)=>{ const x=weekTotals(g.days), cx=pl+bw*i+bw/2, w=Math.min(34,bw*.6);
    return `<rect x="${cx-w/2}" y="${y(x.p)}" width="${w}" height="${y(0)-y(x.p)}" rx="3" fill="none" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1.2"/>
      <rect x="${cx-w/2+4}" y="${y(x.a)}" width="${Math.max(0,w-8)}" height="${y(0)-y(x.a)}" rx="2" fill="var(--accent)"/>
      <text x="${cx}" y="${H-8}" text-anchor="middle" font-size="10" fill="var(--muted)">${md(g.mon)}週</text>`; }).join("");
  return `
  <h2>記録</h2>
  <div class="stats">
    <div class="stat"><span class="label">累計距離</span><b>${fmtKm(stats.totalKm)}<small class="small"> km</small></b></div>
    <div class="stat"><span class="label">実施率</span><b>${stats.rate==null?"—":stats.rate}<small class="small">${stats.rate==null?"":" %"}</small></b></div>
    <div class="stat"><span class="label">記録日数</span><b>${dates.filter(d=>S.logs[d]).length}<small class="small"> 日</small></b></div>
  </div>
  <section class="panel">
    <span class="label">週ごとの距離（km）</span>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="週ごとの予定距離と実績距離">${ticks}${bars}</svg>
    <div class="legend"><span><i style="border:1.2px dashed var(--muted)"></i>予定</span><span><i style="background:var(--accent)"></i>実績</span></div>
  </section>
  <section class="stack">
    <h3>練習日誌</h3>
    ${logged.length ? logged.slice().reverse().map(d=>{ const l = S.logs[d]||{}, p = plan[d], cm = S.comments[d];
      return `<button class="panel log-item" data-day="${d}">
        <div class="spread"><b>${md(d)}（${WD[wd(d)]}） ${esc(p?.title||"")}</b>${stBadge(d)}</div>
        ${runsOf(l).length ? `<div class="stack" style="gap:2px">${runsOf(l).map((r,i)=>{ const sec = parseTime(r.time);
          return `<div class="row small num" style="gap:12px">${runsOf(l).length>1?`<span class="muted">${i+1}回目</span>`:""}<span>${r.km!=="" && r.km!=null ? fmtKm(r.km)+" km" : "— km"}</span><span>${r.time?esc(r.time):"—"}</span><span>${r.km&&sec?fmtTime(sec/r.km)+"/km":""}</span>${r.gps?`<span class="chip" style="--c:var(--accent)">GPS</span>`:""}</div>`; }).join("")}</div>` : ""}
        ${l.rpe||l.cond ? `<div class="row small" style="gap:12px">${l.rpe?`<span>きつさ ${esc(l.rpe)}/10</span>`:""}${l.cond?`<span>体調 ${esc(l.cond)}</span>`:""}</div>` : ""}
        ${l.meal?`<p class="small muted">食事：${esc(l.meal)}</p>`:""}
        ${l.memo?`<p class="small muted">メモ：${esc(l.memo)}</p>`:""}
        ${cm?`<div class="cm-box"><span class="label">管理者より${Seen.isNew("comments/"+d)?` <span class="new-dot">NEW</span>`:""}</span><p>${nl2br(cm.text)}</p></div>`:""}
      </button>`;}).join("")
      : `<div class="empty">まだ記録がありません。<br>「今日」タブから練習を記録しましょう。</div>`}
  </section>
  <button class="btn ghost" data-act="trash">ゴミ箱（削除した記録の復旧）${Object.keys(S.trash).length ? `・${Object.keys(S.trash).length}件` : ""}</button>`;
}

function viewAdvice(){
  const ph = phaseOf(todayStr()), raceD = S.settings.raceDate, a = advice(), admin = Admin.on();
  const ranges = {base:`〜${md(addDays(raceD,-8))}`, week:`${md(addDays(raceD,-7))}〜${md(addDays(raceD,-4))}`, load:`${md(addDays(raceD,-3))}〜${md(addDays(raceD,-2))}`, eve:md(addDays(raceD,-1)), race:md(raceD), after:`${md(addDays(raceD,1))}〜`};
  const w = Number(S.settings.weight)||60;
  const secs = ADVICE_SECTIONS.filter(s=>admin || (a.sections||{})[s.id]);
  Seen.mark("advice", (S.meta||{}).advice||0);
  const checks = S.checks || {};
  const cl = checklist(), doneN = cl.filter(c=>checks[c.id]).length;
  return `
  <h2>アドバイス</h2>
  <section class="stack">
    <div class="spread"><h3>管理者からのアドバイス</h3>${admin?`<span class="small muted">各欄の「編集」で書き込めます</span>`:""}</div>
    ${secs.length ? secs.map(s=>{ const txt = (a.sections||{})[s.id]||""; const now = s.phases.includes(ph);
      return `<section class="panel adv-sec${now?" now":""}" data-sec="${s.id}">
        <div class="spread"><h3>${s.title}</h3>${now?`<span class="st st-done">いまここ</span>`:""}${admin?`<button class="btn ghost" data-act="advedit" data-id="${s.id}">編集</button>`:""}</div>
        ${txt ? `<p class="adv-text">${nl2br(txt)}</p>` : `<p class="small muted">${s.hint}（まだ書かれていません）</p>`}
      </section>`; }).join("")
      : `<div class="empty">管理者からのアドバイスはまだありません。</div>`}
  </section>

  <section class="panel">
    <div class="spread"><h3>持ち物・準備チェック</h3><span class="small num">${doneN} / ${cl.length}</span></div>
    <div class="checks">${cl.map(c=>`<label class="check"><input type="checkbox" data-check="${c.id}" ${checks[c.id]?"checked":""}><span>${esc(c.text)}</span></label>`).join("")}</div>
    ${admin?`<button class="btn ghost" data-act="checkedit">項目を編集</button>`:""}
  </section>

  <h3 style="margin-top:6px">食事の基本（一般的な目安）</h3>
  <section class="panel">
    <span class="label">体重 ${esc(w)}kg での目安（設定で変更できます）</span>
    <div class="calc">
      <div><span class="small muted">カーボローディング</span><b>${Math.round(w*7)}〜${Math.round(w*10)}g</b><span class="small muted">炭水化物/日</span></div>
      <div><span class="small muted">当日の朝食</span><b>${Math.round(w*2)}〜${Math.round(w*3)}g</b><span class="small muted">炭水化物</span></div>
      <div><span class="small muted">レース中</span><b>30〜60g</b><span class="small muted">炭水化物/時</span></div>
    </div>
    <p class="small muted">ごはん茶碗1杯(150g)≒炭水化物55g、食パン6枚切1枚≒27g、バナナ1本≒22g、もち1個≒25g、うどん1玉≒50g</p>
  </section>
  ${foodPhases().map(f=>`
    <details class="phase${(ph===f.id)?" now":""}" style="--pc:var(${f.pc})" ${ph===f.id?"open":""}>
      <summary><span class="label">${f.when}（${ranges[f.id]}）</span> <b>${f.title}</b>${ph===f.id?` <span class="st st-done">いまここ</span>`:""}</summary>
      <ul class="tip-list small">${f.tips.map(x=>`<li>${x}</li>`).join("")}</ul>
    </details>`).join("")}
  <p class="note">一般的な目安です。持病のある方、食事制限のある方、体調に不安がある方は医師・管理栄養士に相談してください。</p>`;
}

function viewSetup(){
  const s = S.settings, admin = Admin.on(), hasPin = !!(S.admin && S.admin.pinHash);
  return `
  <h2>設定</h2>
  <form class="panel" id="setForm">
    <label class="field"><span>大会名</span><input class="inp" id="setName" value="${esc(s.raceName)}"></label>
    <div class="grid2">
      <label class="field"><span>レース日</span><input class="inp" type="date" id="setDate" value="${esc(s.raceDate)}"></label>
      <label class="field"><span>目標タイム（例 40000 → 4:00:00）</span><input class="inp num t-in" id="setGoal" inputmode="numeric" placeholder="4:00:00" value="${esc(s.goal)}"></label>
    </div>
    <label class="field"><span>体重（kg）・食事量の計算に使います</span><input class="inp" type="number" inputmode="decimal" step="0.1" id="setWeight" value="${esc(s.weight)}"></label>
    <button class="btn primary" type="submit">保存</button>
    ${S.registered?`<p class="small muted">登録済みのプランの日付はレース日を変えても動きません。作り直す場合は下の「プランを作り直す」を使ってください。</p>`:""}
  </form>

  <section class="panel" id="shareSec">
    <h3>2人で共有（Googleスプレッドシート）</h3>
    ${Sync.cfg ? `
      <div class="spread"><span class="small">状態：<b>${esc(syncLabel())}</b></span><button class="btn" data-act="syncnow">今すぐ同期</button></div>
      ${Sync.state==="error" && Sync.err ? `<p class="note">${esc(Sync.err)}</p>` : ""}
      <label class="field"><span>ランナーに送るリンク（このリンクから開くと共有された状態で始まります）</span><input class="inp small" id="shareLink" readonly value="${esc(Sync.link())}"></label>
      <div class="row"><button class="btn primary" data-act="copylink">リンクをコピー</button><button class="btn ghost danger" data-act="unshare">この端末の共有を解除</button></div>
      <p class="small muted">リンクには合言葉が入っています。ランナー以外には送らないでください。</p>`
    : `
      <p class="small muted">管理者がスプレッドシートを用意すると、ランナーと管理者が同じ予定・記録を見て編集できます。手順は「使い方と公開手順」の「2人で共有する」を見てください。</p>
      <label class="field"><span>ウェブアプリのURL</span><input class="inp" id="shUrl" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="field"><span>合言葉</span><input class="inp" id="shKey" autocomplete="off"></label>
      <button class="btn primary" data-act="share">接続する</button>`}
  </section>

  <section class="panel">
    <h3>管理者モード</h3>
    ${admin ? `<p class="small">この端末は <b>管理者モード</b> です。アドバイスの編集、記録へのコメント、見守り画面が使えます。</p>
      <button class="btn" data-act="adminoff">管理者モードを終了</button>`
    : `<p class="small muted">管理者用です。暗証番号を入れると、アドバイスの編集・記録へのコメント・見守り画面が使えるようになります（この端末だけ）。</p>
      <label class="field"><span>${hasPin ? "暗証番号" : "暗証番号を決める（4桁以上）"}</span><input class="inp" type="password" inputmode="numeric" id="adminPin" autocomplete="off"></label>
      <button class="btn" data-act="adminon">${hasPin ? "管理者モードにする" : "暗証番号を決めて管理者モードにする"}</button>`}
  </section>

  <section class="panel">
    <h3>バックアップ</h3>
    <p class="small muted">${Sync.cfg ? "データはこのスマホとスプレッドシートに保存されています。念のため、ときどきバックアップもしておくと安心です。" : "データはこのスマホの中だけに保存されます。機種変更やブラウザのデータ削除に備えて、ときどきバックアップしてください。"}</p>
    <div class="row"><button class="btn" data-act="export">バックアップを保存</button><button class="btn" data-act="copy">テキストでコピー</button></div>
    <label class="field"><span>復元（ファイルを選ぶ）</span><input class="inp" type="file" id="importFile" accept="application/json,.json,text/plain"></label>
    <label class="field"><span>復元（コピーしたテキストを貼り付け）</span><textarea class="inp" id="importText" placeholder='{"v":2,...}'></textarea></label>
    <button class="btn" data-act="importText">貼り付けた内容で復元</button>
  </section>

  <section class="panel">
    <h3>ホーム画面に追加</h3>
    <p class="small"><b>iPhone（Safari）</b>：下の共有ボタン <span aria-hidden="true">⬆︎</span> →「ホーム画面に追加」</p>
    <p class="small"><b>Android（Chrome）</b>：右上の「⋮」→「ホーム画面に追加」または「アプリをインストール」</p>
    <p class="small muted">ホーム画面から開くとアプリのように全画面で使え、電波がなくても動きます。iPhoneはホーム画面から使うと保存データが消えにくくなります。</p>
  </section>

  <section class="panel">
    <div class="spread"><h3>ゴミ箱</h3><span class="small muted">${Object.keys(S.trash).length}件</span></div>
    <p class="small muted">削除した予定・記録・コメントなどは${TRASH_DAYS}日間残ります。復旧するか、完全に削除するかを選べます。</p>
    <button class="btn" data-act="trash">ゴミ箱を開く</button>
  </section>

  <section class="panel">
    <h3>リセット</h3>
    <div class="row"><button class="btn" data-act="rebuild">プランを作り直す</button><button class="btn danger" data-act="wipe">すべてのデータを消去</button></div>
    <div id="confirmBox"></div>
  </section>`;
}

function render(){
  document.querySelectorAll(".tab").forEach(b=>{
    b.setAttribute("aria-selected", b.dataset.tab===tab ? "true":"false");
    if(b.dataset.tab==="advice") b.classList.toggle("has-new", Seen.isNew("advice"));
    if(b.dataset.tab==="log") b.classList.toggle("has-new", newComments().length>0);
  });
  const v = {today:viewToday, plan:viewPlan, log:viewLog, advice:viewAdvice, setup:viewSetup}[tab]();
  app.innerHTML = topBar() + v;
  renderSaveState();
  placeJourney();
}

/* ---------- 日の画面（予定・実績・コメント） ---------- */
function openDay(date, isNew){
  const plan = activePlan();
  const p = Object.assign({t:"jog",km:"",title:"",detail:""}, plan[date]||{});
  const l = Object.assign({status:"",rpe:"",cond:"",sleep:"",weight:"",meal:"",memo:"",runs:[]}, JSON.parse(JSON.stringify(S.logs[date]||{})));
  let runs = l.runs.length ? l.runs : [{id:uid(), km:"", time:""}];
  const origRuns = clone(l.runs), origLog = clone(S.logs[date]);
  let delArmed = false;
  const cm = S.comments[date], admin = Admin.on();
  const isFuture = date > todayStr();
  const startPane = isFuture && !S.logs[date] ? "pl" : "rec";
  if(cm) Seen.mark("comments/"+date, (S.meta||{})["comments/"+date]);
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<form class="sheet" id="dayForm" role="dialog" aria-label="${md(date)}の予定と記録">
    <div class="sheet-grip"></div>
    <div class="spread">
      ${isNew?`<label class="field" style="flex:1"><span>日付</span><input class="inp" type="date" id="dDate" value="${date}"></label>`
             :`<h2>${md(date)}（${WD[wd(date)]}）</h2>`}
      <button type="button" class="btn ghost" data-close>閉じる</button>
    </div>
    <div class="seg" role="group" aria-label="表示切替">
      <button type="button" data-pane="rec" aria-pressed="${startPane==="rec"}">実績を記録</button>
      <button type="button" data-pane="pl" aria-pressed="${startPane==="pl"}">予定を編集</button>
    </div>

    <div class="stack" data-panel="pl" ${startPane==="pl"?"":"hidden"}>
      <div class="grid2">
        <label class="field"><span>種類</span><select class="inp" id="pType">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${p.t===k?"selected":""}>${v.label}</option>`).join("")}</select></label>
        <label class="field"><span>予定距離（km）</span><input class="inp" type="number" inputmode="decimal" step="0.1" min="0" id="pKm" value="${esc(p.t==="rest"?"":p.km)}" ${p.t==="rest"?"disabled":""}></label>
      </div>
      <label class="field"><span>メニュー名</span><input class="inp" id="pTitle" value="${esc(p.title)}" placeholder="空欄なら種類と距離から自動で付けます"></label>
      <label class="field"><span>内容・ポイント</span><textarea class="inp" id="pDetail" placeholder="ペースや本数など">${esc(p.detail)}</textarea></label>
      ${!isNew ? `<details class="move-box"><summary class="small"><b>予定を動かす</b>（練習日がずれたとき）</summary>
        <div class="stack" style="margin-top:8px">
          <div class="row"><input class="inp" type="date" id="swapDate" style="flex:1;min-width:0" value="${addDays(date,1)}"><button type="button" class="btn" data-act="swap">この日と入れ替える</button></div>
          <button type="button" class="btn" data-act="shift">この日から後ろを1日ずつずらす</button>
          <p class="small muted">「1日ずつずらす」は、この日を休養にして予定を1日後ろへ送ります。後ろの最初の休養日で吸収するので、レース当日は動きません。</p>
        </div></details>` : ""}
      ${!isNew && plan[date]?`<button type="button" class="btn danger" data-act="delplan">この日の予定を削除</button>`:""}
    </div>

    <div class="stack" data-panel="rec" ${startPane==="rec"?"":"hidden"}>
      ${plan[date]?`<div class="note"><b>予定：</b>${esc(p.title)}${p.km&&p.t!=="rest"?"（"+fmtKm(p.km)+"km）":""}</div>`:""}
      <div class="field"><span>結果</span>
        <div class="seg" id="rStatus">${["done","part","miss","skip"].map(k=>`<button type="button" data-st="${k}" aria-pressed="${l.status===k}">${ST_LABEL[k]}</button>`).join("")}</div>
        <span class="small muted">走った記録があれば、選ばなくても予定の距離と比べて自動で判定します</span>
      </div>
      <div class="stack" id="runsBox"></div>
      <p class="small muted" id="runDelNote" hidden>削除した回は「保存」を押すとゴミ箱に移ります（30日間は復旧できます）。保存しなければ元のままです。</p>
      <button type="button" class="btn" data-act="addrun">＋ もう1回分を追加（同じ日に2回走ったとき）</button>
      <div class="grid3">
        <label class="field"><span>きつさ(1-10)</span><select class="inp" id="rRpe"><option value="">—</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option ${String(l.rpe)===String(n)?"selected":""}>${n}</option>`).join("")}</select></label>
        <label class="field"><span>体調</span><select class="inp" id="rCond">${["","良い","普通","疲れ","痛みあり","不調"].map(c=>`<option ${l.cond===c?"selected":""} value="${c}">${c||"—"}</option>`).join("")}</select></label>
        <label class="field"><span>睡眠(時間)</span><input class="inp" type="number" inputmode="decimal" step="0.5" min="0" id="rSleep" value="${esc(l.sleep)}"></label>
      </div>
      <label class="field"><span>体重（kg）</span><input class="inp" type="number" inputmode="decimal" step="0.1" id="rWeight" value="${esc(l.weight)}"></label>
      <label class="field"><span>食事・補給メモ</span><textarea class="inp" id="rMeal" placeholder="例：朝 おにぎり2個、練習後 プロテイン">${esc(l.meal)}</textarea></label>
      <label class="field"><span>メモ（脚の状態・気づき）</span><textarea class="inp" id="rMemo">${esc(l.memo)}</textarea></label>
      ${admin ? `<label class="field cm-edit"><span>管理者コメント（ランナーに表示されます）</span><textarea class="inp" id="rComment" placeholder="例：後半上げられていて良い内容。明日はしっかり休もう">${esc(cm?.text||"")}</textarea></label>`
        : cm ? `<div class="cm-box"><span class="label">管理者より</span><p>${nl2br(cm.text)}</p></div>` : ""}
      ${S.logs[date]?`<button type="button" class="btn danger" data-act="dellog">${runsOf(S.logs[date]).length>1 ? `この日の記録をまるごと削除（${runsOf(S.logs[date]).length}回分すべて）` : "この日の記録をまるごと削除"}</button>`:""}
    </div>
    <button class="btn primary wide" type="submit">保存</button>
  </form>`;
  document.body.appendChild(bg);
  document.body.style.overflow = "hidden";
  const f = bg.querySelector("form");
  const $ = s => f.querySelector(s);
  let st = l.status;
  const close = () => { bg.remove(); document.body.style.overflow = ""; render(); };

  const readRuns = () => { runs = runs.map(r=>{ const box = f.querySelector(`[data-run="${r.id}"]`); if(!box) return r;
    const km = box.querySelector(".r-km").value; return Object.assign({}, r, {km: km==="" ? "" : Number(km), time: normTime(box.querySelector(".r-time").value)}); }); };
  const drawRuns = () => {
    $("#runsBox").innerHTML = runs.map((r,i)=>`<div class="run-box" data-run="${r.id}">
      <div class="spread"><b class="small">${runs.length>1 ? (i+1)+"回目" : "走った記録"}${r.gps?` <span class="chip" style="--c:var(--accent)">GPS</span>`:""}</b>${runs.length>1?`<button type="button" class="btn ghost danger" data-delrun="${r.id}">${i+1}回目だけ削除</button>`:""}</div>
      <div class="grid2">
        <label class="field"><span>距離（km）</span><input class="inp r-km" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(r.km)}"></label>
        <label class="field"><span>タイム（例 5830 → 58:30）</span><input class="inp num r-time t-in" inputmode="numeric" placeholder="58:30" value="${esc(r.time)}"></label>
      </div>
      <p class="small muted r-pace"></p>
      ${r.laps && r.laps.length ? lapTable(r.laps) : ""}
    </div>`).join("");
    paceUpd();
  };
  const paceUpd = () => f.querySelectorAll(".run-box").forEach(b=>{
    const k = Number(b.querySelector(".r-km").value), s = parseTime(b.querySelector(".r-time").value);
    b.querySelector(".r-pace").textContent = k && s ? "平均ペース "+fmtTime(s/k)+"/km" : "";
  });
  drawRuns();
  f.addEventListener("input", e=>{ if(e.target.closest(".run-box")) paceUpd(); });

  // 種類を変えたら、予定距離・メニュー名・内容をリセット
  let prevType = p.t;
  $("#pType").addEventListener("change", e=>{
    const t = e.target.value, title = $("#pTitle").value.trim();
    const autoTitle = !title || new RegExp("^("+Object.values(TYPES).map(x=>x.label).join("|")+")( [\\d.]+km)?$").test(title) || title===p.title;
    if(t==="rest"){ $("#pKm").value = ""; $("#pKm").disabled = true; $("#pTitle").value = "休養"; $("#pDetail").value = ""; }
    else {
      $("#pKm").disabled = false;
      if(prevType==="rest"){ $("#pKm").value = ""; $("#pTitle").value = ""; $("#pDetail").value = ""; }
      else if(autoTitle){ $("#pTitle").value = ""; $("#pDetail").value = ""; }
    }
    prevType = t;
  });

  bg.addEventListener("click", e=>{
    if(e.target===bg || e.target.closest("[data-close]")) return close();
    const pn = e.target.closest("[data-pane]");
    if(pn){ f.querySelectorAll("[data-pane]").forEach(b=>b.setAttribute("aria-pressed", b===pn)); f.querySelectorAll("[data-panel]").forEach(x=>x.hidden = x.dataset.panel!==pn.dataset.pane); }
    const sb = e.target.closest("[data-st]");
    if(sb){ st = st===sb.dataset.st ? "" : sb.dataset.st; f.querySelectorAll("[data-st]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.st===st));
      if(st==="done" && runs.length===1 && !f.querySelector(".r-km").value && p.km && p.t!=="rest"){ f.querySelector(".r-km").value = p.km; paceUpd(); } }
    const dr = e.target.closest("[data-delrun]");
    if(dr){ readRuns(); runs = runs.filter(r=>r.id!==dr.dataset.delrun); drawRuns(); $("#runDelNote").hidden = false; }
    const ab = e.target.closest("[data-act]"), act = ab?.dataset.act;
    if(act==="addrun"){ readRuns(); runs.push({id:uid(), km:"", time:""}); drawRuns(); }
    if(act==="delplan"){ ensureRegistered(); const id = toTrash("plan", date, S.plan[date]); delete S.plan[date]; save(); close(); toastUndo("予定をゴミ箱に移しました", id); }
    if(act==="dellog"){
      if(!delArmed){ delArmed = true; const t = ab.textContent; ab.textContent = "もう一度押すと削除します（ゴミ箱に移動）"; setTimeout(()=>{ delArmed = false; if(ab.isConnected) ab.textContent = t; }, 4000); return; }
      const id = toTrash("log", date, S.logs[date]); delete S.logs[date]; save(); close(); toastUndo("この日の記録をゴミ箱に移しました", id);
    }
    if(act==="swap"){
      const d2 = $("#swapDate").value; if(!d2 || d2===date) return;
      ensureRegistered(); const a = S.plan[date], b = S.plan[d2];
      if(b) S.plan[date] = b; else delete S.plan[date];
      if(a) S.plan[d2] = a; else delete S.plan[d2];
      save(); close(); toast(`${md(date)} と ${md(d2)} の予定を入れ替えました`);
    }
    if(act==="shift"){
      ensureRegistered();
      const race = S.settings.raceDate; let r = addDays(date,1);
      while(r < race && S.plan[r] && S.plan[r].t!=="rest") r = addDays(r,1);
      if(r >= race){ toast("レースまでに休養日がないため、ずらせません。入れ替えを使ってください"); return; }
      for(let x = r; x > date; x = addDays(x,-1)) S.plan[x] = S.plan[addDays(x,-1)];
      S.plan[date] = {t:"rest", km:0, title:"休養", detail:"（予定を後ろにずらしました）"};
      save(); close(); toast(`${md(addDays(date,1))}〜${md(r)} に1日ずつずらしました`);
    }
  });
  f.addEventListener("submit", e=>{
    e.preventDefault();
    readRuns();
    const d = isNew ? ($("#dDate").value || date) : date;
    const t = $("#pType").value;
    const np = {t, km: t==="rest" ? 0 : (Number($("#pKm").value)||0), title:$("#pTitle").value.trim(), detail:$("#pDetail").value.trim()};
    if(!np.title) np.title = TYPES[t].label + (np.km?" "+fmtKm(np.km)+"km":"");
    const old = plan[d];
    const planChanged = !old || old.t!==np.t || Number(old.km)!==np.km || old.title!==np.title || (old.detail||"")!==np.detail;
    if(planChanged || isNew){ ensureRegistered(); S.plan[d] = np; }
    const keepRuns = runs.filter(r=>(r.km!=="" && r.km!=null) || r.time || (r.laps && r.laps.length));
    const nl = {status:st, rpe:$("#rRpe").value, cond:$("#rCond").value, sleep:$("#rSleep").value, weight:$("#rWeight").value,
      meal:$("#rMeal").value.trim(), memo:$("#rMemo").value.trim(), runs:keepRuns};
    const keepIds = new Set(keepRuns.map(r=>r.id)), trashed = [];
    if(d===date) origRuns.filter(r=>!keepIds.has(r.id) && ((r.km!=="" && r.km!=null) || r.time || (r.laps && r.laps.length))).forEach(r=>trashed.push(toTrash("run", d, r)));
    if(keepRuns.length || ["status","rpe","cond","sleep","weight","meal","memo"].some(k=>nl[k])) S.logs[d] = nl;
    else { if(d===date && origLog && !trashed.length) trashed.push(toTrash("log", d, origLog)); delete S.logs[d]; }
    if(admin){
      const c = $("#rComment").value.trim();
      if(c && c!==(cm?.text||"")) S.comments[d] = {text:c, at:Date.now()};
      else if(!c && cm){ trashed.push(toTrash("comment", d, cm)); delete S.comments[d]; }
    }
    save(); close();
    if(trashed.length) toastUndo(`保存しました（${trashed.length}件をゴミ箱に移しました）`, trashed); else toast("保存しました");
  });
}
function lapTable(laps){
  return `<details><summary class="small"><b>GPSラップ（${laps.length}本）</b></summary><div style="overflow-x:auto"><table class="lap-table">
    <thead><tr><th>km</th><th>ラップ</th></tr></thead>
    <tbody>${laps.map(x=>`<tr><td>${x.km}</td><td>${fmtTime(x.sec)}${x.est?"*":""}</td></tr>`).join("")}</tbody></table></div>
    ${laps.some(x=>x.est)?`<p class="small muted">* 画面オフ中を含む推定</p>`:""}</details>`;
}

/* ---------- アドバイスの編集（管理者） ---------- */
function editAdvice(id){
  const sec = document.querySelector(`[data-sec="${id}"]`); if(!sec) return;
  const meta = ADVICE_SECTIONS.find(s=>s.id===id), txt = (advice().sections||{})[id]||"";
  sec.dataset.editing = "1";
  sec.innerHTML = `<h3>${meta.title}</h3><p class="small muted">${meta.hint}</p>
    <textarea class="inp adv-input" id="advIn" rows="6">${esc(txt)}</textarea>
    <div class="row"><button class="btn primary" data-act="advsave" data-id="${id}">保存</button><button class="btn ghost" data-act="advcancel">やめる</button></div>`;
  sec.querySelector("textarea").focus();
}
function editChecklist(){
  const box = document.querySelector(".checks"); if(!box) return;
  const panel = box.closest(".panel"); panel.dataset.editing = "1";
  panel.innerHTML = `<h3>持ち物・準備チェックの項目</h3><p class="small muted">1行に1項目。ランナーのチェックは、同じ文字の項目なら残ります。</p>
    <textarea class="inp" id="clIn" rows="10">${esc(checklist().map(c=>c.text).join("\n"))}</textarea>
    <div class="row"><button class="btn primary" data-act="clsave">保存</button><button class="btn ghost" data-act="advcancel">やめる</button></div>`;
}

/* ---------- misc actions ---------- */
let toastT;
function toast(msg, action){
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status");
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  if(action){ const b = document.createElement("button"); b.type = "button"; b.textContent = action.label; b.onclick = ()=>{ t.remove(); action.fn(); }; t.appendChild(b); }
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(()=>t.remove(), action ? 7000 : 2400);
}
// 削除の直後に「元に戻す」を出す
function toastUndo(msg, ids){
  ids = [].concat(ids);
  toast(msg, {label:"元に戻す", fn:()=>{ ids.forEach(restoreTrash); render(); toast("元に戻しました"); }});
}

/* ---------- ゴミ箱の画面 ---------- */
function openTrash(){
  if(purgeTrash()) save();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  const draw = () => {
    const items = Object.entries(S.trash).sort((a,b)=>b[1].at-a[1].at);
    bg.innerHTML = `<div class="sheet" role="dialog" aria-label="ゴミ箱">
      <div class="sheet-grip"></div>
      <div class="spread"><h2>ゴミ箱</h2><button type="button" class="btn ghost" data-close>閉じる</button></div>
      <p class="small muted">削除したデータは${TRASH_DAYS}日間ここに残り、復旧できます。${Sync.cfg ? "共有中は、ランナーと管理者のどちらが削除したものも入ります。" : ""}</p>
      ${items.length ? `
        <div class="trash-bar">
          <label class="check" style="border:0;padding:0"><input type="checkbox" id="trAll"><span class="small">すべて選択</span></label>
          <div class="row"><button type="button" class="btn primary" data-tr="restoreSel" disabled>選択を復旧する</button><button type="button" class="btn danger" data-tr="purgeSel" disabled>選択を完全に削除</button></div>
        </div>
        <div id="trConfirm"></div>
        <div class="stack trash-list">${items.map(([id,t])=>{ const left = Math.max(0, TRASH_DAYS - Math.floor((Date.now()-t.at)/864e5)); const at = new Date(t.at);
          return `<div class="trash-item">
            <label class="check" style="border:0;padding:0;align-items:flex-start"><input type="checkbox" data-trsel="${id}"><span><b>${esc(trashLabel(t))}</b><br><span class="small muted">${at.getMonth()+1}/${at.getDate()} ${at.getHours()}:${pad(at.getMinutes())} に削除・あと${left}日で自動で消えます</span></span></label>
            <div class="row"><button type="button" class="btn" data-tr="restore" data-id="${id}">復旧する</button><button type="button" class="btn ghost danger" data-tr="purge" data-id="${id}">完全に削除</button></div>
          </div>`; }).join("")}</div>`
      : `<div class="empty">ゴミ箱は空です。</div>`}
    </div>`;
  };
  const selected = () => [...bg.querySelectorAll("[data-trsel]:checked")].map(i=>i.dataset.trsel);
  const syncBar = () => { const n = selected().length; bg.querySelectorAll("[data-tr$='Sel']").forEach(b=>{ b.disabled = !n; b.textContent = (b.dataset.tr==="restoreSel" ? "選択を復旧する" : "選択を完全に削除") + (n ? `（${n}件）` : ""); }); };
  const confirmPurge = (ids) => {
    const box = bg.querySelector("#trConfirm");
    box.innerHTML = `<div class="note" style="display:grid;gap:8px"><span>${ids.length}件を完全に削除します。完全に削除すると、もう復旧できません。</span><div class="row"><button type="button" class="btn danger" data-tr="purgeYes">完全に削除する</button><button type="button" class="btn" data-tr="purgeNo">やめる</button></div></div>`;
    box.dataset.ids = ids.join(",");
    box.scrollIntoView({block:"nearest"});
  };
  draw();
  document.body.appendChild(bg);
  document.body.style.overflow = "hidden";
  const close = () => { bg.remove(); document.body.style.overflow = ""; render(); };
  bg.addEventListener("change", e=>{
    if(e.target.id==="trAll") bg.querySelectorAll("[data-trsel]").forEach(i=>i.checked = e.target.checked);
    syncBar();
  });
  bg.addEventListener("click", e=>{
    if(e.target===bg || e.target.closest("[data-close]")) return close();
    const b = e.target.closest("[data-tr]"); if(!b) return;
    const a = b.dataset.tr;
    if(a==="restore"){ restoreTrash(b.dataset.id); draw(); toast("復旧しました"); }
    if(a==="restoreSel"){ const ids = selected(); ids.forEach(restoreTrash); draw(); toast(`${ids.length}件を復旧しました`); }
    if(a==="purge") confirmPurge([b.dataset.id]);
    if(a==="purgeSel") confirmPurge(selected());
    if(a==="purgeNo") bg.querySelector("#trConfirm").innerHTML = "";
    if(a==="purgeYes"){ const ids = bg.querySelector("#trConfirm").dataset.ids.split(","); ids.forEach(id=>delete S.trash[id]); save(); draw(); toast(`${ids.length}件を完全に削除しました`); }
  });
}
function exportText(){ return JSON.stringify(S); }
function importData(txt){
  try{
    const d = JSON.parse(txt);
    if(!d || typeof d!=="object" || !d.settings || !d.logs) throw 0;
    S = normalize(Object.assign({}, d, {meta:S.meta}));
    save(); render(); toast("復元しました");
  }catch(e){ toast("読み込めませんでした。バックアップの内容を確認してください"); }
}
function confirmBox(msg, label, fn){
  const box = document.getElementById("confirmBox");
  box.innerHTML = `<div class="note" style="display:grid;gap:8px"><span>${msg}</span><div class="row"><button class="btn danger" id="cfYes">${label}</button><button class="btn" id="cfNo">やめる</button></div></div>`;
  box.querySelector("#cfYes").onclick = fn;
  box.querySelector("#cfNo").onclick = () => box.innerHTML = "";
}
function goTab(t){ tab = t; history.replaceState(null,"","#"+tab); render(); window.scrollTo(0,0); }

document.addEventListener("click", async e=>{
  const tb = e.target.closest(".tab");
  if(tb){ goTab(tb.dataset.tab); return; }
  if(e.target.closest(".sheet-bg") || e.target.closest(".run")) return;
  const go = e.target.closest("[data-go]");
  if(go){ goTab(go.dataset.go); return; }
  const day = e.target.closest("[data-day]");
  if(day){ openDay(day.dataset.day, false); return; }
  const ab = e.target.closest("[data-act]"), act = ab?.dataset.act;
  if(!act) return;
  if(act==="register"){ ensureRegistered(); save(); render(); toast("プランを登録しました"); }
  if(act==="addday"){ openDay(todayStr(), true); }
  if(act==="advedit") editAdvice(ab.dataset.id);
  if(act==="advcancel") render();
  if(act==="advsave"){
    const a = JSON.parse(JSON.stringify(advice())); a.sections = a.sections||{};
    const sec = ab.dataset.id, old = a.sections[sec], nv = document.getElementById("advIn").value.trim();
    a.sections[sec] = nv;
    const tid = old && !nv ? toTrash("advice", null, old, {sec}) : null;
    S.advice = a; save(); render();
    if(tid) toastUndo("アドバイスを消しました（ゴミ箱に移動）", tid); else toast("アドバイスを保存しました");
  }
  if(act==="trash") openTrash();
  if(act==="checkedit") editChecklist();
  if(act==="clsave"){
    const old = checklist(), lines = document.getElementById("clIn").value.split("\n").map(s=>s.trim()).filter(Boolean);
    const a = JSON.parse(JSON.stringify(advice()));
    a.checklist = lines.map(t=>({id:(old.find(c=>c.text===t)||{}).id || uid(), text:t}));
    S.advice = a; save(); render(); toast("項目を保存しました");
  }
  if(act==="adminon"){
    const pin = document.getElementById("adminPin").value.trim();
    if(!/^\d{4,}$/.test(pin)){ toast("暗証番号は4桁以上の数字にしてください"); return; }
    const h = await Admin.hash(pin);
    if(S.admin && S.admin.pinHash){ if(S.admin.pinHash!==h){ toast("暗証番号が違います"); return; } }
    else { S.admin = {pinHash:h}; save(); }
    Admin.set(true); render(); toast("管理者モードにしました");
  }
  if(act==="adminoff"){ Admin.set(false); render(); toast("管理者モードを終了しました"); }
  if(act==="export"){
    const blob = new Blob([exportText()],{type:"application/json"});
    const file = new File([blob], `marathon-backup-${todayStr()}.json`, {type:"application/json"});
    if(navigator.canShare && navigator.canShare({files:[file]})){ navigator.share({files:[file], title:"練習データのバックアップ"}).catch(()=>{}); }
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 5000); }
  }
  if(act==="copy"){
    const txt = exportText(), ta = document.getElementById("importText");
    try{ await navigator.clipboard.writeText(txt); toast("コピーしました。メモアプリなどに貼り付けて保管してください"); }
    catch(err){ ta.value = txt; ta.select(); toast("テキストを選択しました。コピーしてください"); }
  }
  if(act==="importText"){ const v = document.getElementById("importText").value.trim(); if(v) importData(v); }
  if(act==="rebuild") confirmBox("現在の予定を、レース日から逆算したおすすめプランに置き換えます（実績の記録は残ります。今の予定はゴミ箱に移ります）。", "作り直す", ()=>{ const id = S.registered ? toTrash("plans", null, S.plan) : null; S.registered=false; S.plan={}; ensureRegistered(); save(); render(); id ? toastUndo("プランを作り直しました", id) : toast("プランを作り直しました"); });
  if(act==="share"){
    const url = document.getElementById("shUrl").value.trim(), key = document.getElementById("shKey").value.trim();
    if(!/^https:\/\/script\.google(usercontent)?\.com\//.test(url) || !key){ toast("URL（https://script.google.com/…）と合言葉を入力してください"); return; }
    Sync.cfg = {url, key, fresh:true}; Sync.saveCfg(); Sync.set("idle");
    await Sync.run();
    if(Sync.state==="ok") toast("接続しました");
    else { toast(Sync.err || "接続できませんでした"); Sync.cfg = null; Sync.saveCfg(); Sync.set("off"); }
    render();
  }
  if(act==="syncnow"){ await Sync.run(); toast(Sync.state==="ok" ? "同期しました" : (Sync.err || "同期できませんでした")); render(); }
  if(act==="copylink"){
    const inp = document.getElementById("shareLink");
    try{ await navigator.clipboard.writeText(inp.value); toast("コピーしました"); }catch(err){ inp.select(); toast("選択しました。コピーしてください"); }
  }
  if(act==="unshare") confirmBox("この端末だけ共有をやめます。スプレッドシートのデータと、相手の端末はそのまま残ります。", "解除する", ()=>{ Sync.cfg = null; Sync.saveCfg(); Sync.set("off"); render(); toast("共有を解除しました"); });
  if(act==="wipe") confirmBox(Sync.cfg ? `予定・記録・コメント・アドバイス・設定をすべて消去します。共有中なので、相手の端末とスプレッドシートからも消えます。消去前の状態はゴミ箱に${TRASH_DAYS}日間残り、復旧できます。` : `予定・記録・設定をすべて消去します。消去前の状態はゴミ箱に${TRASH_DAYS}日間残り、復旧できます。`, "消去する", ()=>{
    const snap = snapshotAll(), keep = {admin:S.admin, trash:S.trash, meta:S.meta};
    S = freshState(); Object.keys(keep).forEach(k=>{ if(keep[k]!==undefined) S[k] = keep[k]; });
    const id = toTrash("all", null, snap); save(); render(); toastUndo("すべて消去しました（ゴミ箱から復旧できます）", id);
  });
});
document.addEventListener("change", e=>{
  if(e.target.matches("[data-check]")){
    S.checks = Object.assign({}, S.checks||{}, {[e.target.dataset.check]: e.target.checked}); save();
    const cl = checklist(), n = cl.filter(c=>S.checks[c.id]).length; const c = e.target.closest(".panel").querySelector(".spread .num"); if(c) c.textContent = `${n} / ${cl.length}`;
    return;
  }
  if(e.target.id==="importFile" && e.target.files[0]) e.target.files[0].text().then(importData);
});
document.addEventListener("submit", e=>{
  if(e.target.id!=="setForm") return;
  e.preventDefault();
  const s = S.settings;
  s.raceName = document.getElementById("setName").value.trim() || "フルマラソン";
  s.raceDate = document.getElementById("setDate").value || s.raceDate;
  const g = normTime(document.getElementById("setGoal").value);
  s.goal = parseTime(g) ? g : s.goal;
  s.weight = Number(document.getElementById("setWeight").value) || s.weight;
  save(); render(); toast("保存しました");
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape") document.querySelector(".sheet-bg [data-close]")?.click(); });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && !document.querySelector(".sheet-bg") && !editingInline()) render(); });

load();
if(purgeTrash()) save();   // 30日を過ぎたものを片づける
Sync.loadCfg();
if(Sync.cfg){
  Sync.run();
  setInterval(()=>{ if(!document.hidden) Sync.run(); }, 120000);   // 相手の変更を2分ごとに取り込む
  addEventListener("online", ()=>Sync.run());
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) Sync.run(); });
}
{
  const h = location.hash.slice(1);
  if(h==="food") tab = "advice";
  else if(["today","plan","log","advice","setup"].includes(h)) tab = h;
}
render();
if("serviceWorker" in navigator && location.protocol.startsWith("http")){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }

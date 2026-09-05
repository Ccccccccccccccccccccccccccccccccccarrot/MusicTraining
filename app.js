
const STORAGE_KEY = "notetrainer-v01";
const DAILY_COUNT_DEFAULT = 20;
const NOTE_NAMES = ["C","D","E","F","G","A","B"];
const NUMBER_NAMES = {C:1,D:2,E:3,F:4,G:5,A:6,B:7};
const SEMITONES = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const MIDI_MIN = 36; // C2: 下加两点的 1
const MIDI_MAX = 95; // B6: 上加两点的 7

function midiOf(name, octave){ return 12*(octave+1)+SEMITONES[name]; }
function noteId(name, octave){ return `${name}${octave}`; }
function parseNoteId(id){ return {name:id[0], octave:Number(id.slice(1))}; }

function buildLibrary(){
  const arr=[];
  for(let octave=2; octave<=6; octave++){
    for(const name of NOTE_NAMES){
      const midi=midiOf(name,octave);
      if(midi>=MIDI_MIN && midi<=MIDI_MAX) arr.push({id:noteId(name,octave),name,octave,midi});
    }
  }
  return arr;
}
const LIBRARY=buildLibrary();

function freshState(){
  const weights={};
  LIBRARY.forEach(n=>weights[n.id]=0.5);
  return {
    weights,
    settings:{minMidi:48,maxMidi:84,dailyCount:20,treble:true,bass:true,displayMode:"letter",volume:70},
    daily:{date:todayKey(),sight:{done:0,correct:0},ear:{done:0,correct:0}},
    history:[]
  };
}
function loadState(){
  try{
    const x=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(!x) return freshState();
    const f=freshState();
    x.weights={...f.weights,...x.weights};
    x.settings={...f.settings,...x.settings};
    if(!x.daily || x.daily.date!==todayKey()) x.daily=f.daily;
    x.history=x.history||[];
    return x;
  }catch(e){ return freshState(); }
}
let state=loadState();
function save(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
function todayKey(){ return new Date().toISOString().slice(0,10); }
function ensureDay(){
  if(state.daily.date!==todayKey()){
    state.daily={date:todayKey(),sight:{done:0,correct:0},ear:{done:0,correct:0}};
    save();
  }
}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function availableNotes(){
  return LIBRARY.filter(n=>n.midi>=state.settings.minMidi && n.midi<=state.settings.maxMidi && staffOf(n));
}
function staffOf(n){
  // middle C and above favor treble; below middle C favor bass.
  if(n.midi>=60) return state.settings.treble ? "treble" : (state.settings.bass ? "bass":null);
  return state.settings.bass ? "bass" : (state.settings.treble ? "treble":null);
}
function weightedPick(excludeId=null){
  const pool=availableNotes().filter(n=>n.id!==excludeId);
  let total=pool.reduce((s,n)=>s+(state.weights[n.id]||.5),0);
  let r=Math.random()*total;
  for(const n of pool){r-=state.weights[n.id]||.5;if(r<=0)return n}
  return pool[pool.length-1];
}
function optionsFor(correct){
  const pool=availableNotes().filter(n=>n.id!==correct.id);
  const near=pool.slice().sort((a,b)=>Math.abs(a.midi-correct.midi)-Math.abs(b.midi-correct.midi)).slice(0,10);
  const picks=[];
  while(picks.length<3 && near.length){
    const i=Math.floor(Math.random()*near.length);picks.push(near.splice(i,1)[0]);
  }
  return [...picks,correct].sort(()=>Math.random()-.5);
}
function updateWeight(id,correct){
  const old=state.weights[id]??.5;
  state.weights[id]=Number(clamp(old+(correct?-0.05:0.05),0.05,1).toFixed(2));
}
function recordAnswer(mode,note,correct){
  ensureDay();
  state.daily[mode].done++;
  if(correct) state.daily[mode].correct++;
  updateWeight(note.id,correct);
  state.history.push({date:todayKey(),mode,note:note.id,correct,ts:Date.now()});
  if(state.history.length>2000) state.history=state.history.slice(-2000);
  save();
}
function pct(c,d){return d?Math.round(c/d*100):0}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function displayNoteText(noteOrId){
  const n=typeof noteOrId==="string"?{...parseNoteId(noteOrId),id:noteOrId}:noteOrId;
  if(state.settings.displayMode!=="number") return n.id;
  const offset=n.octave-4;
  if(offset===0) return String(NUMBER_NAMES[n.name]);
  return `${NUMBER_NAMES[n.name]}（${offset>0?"上":"下"}${Math.abs(offset)}点）`;
}
function noteLabelHtml(noteOrId){
  const n=typeof noteOrId==="string"?{...parseNoteId(noteOrId),id:noteOrId}:noteOrId;
  if(state.settings.displayMode!=="number") return escapeHtml(n.id);
  const offset=n.octave-4;
  const dots=Array.from({length:Math.abs(offset)},()=>'<i class="octave-dot"></i>').join("");
  return `<span class="numbered-note" role="img" aria-label="${escapeHtml(displayNoteText(n))}">
    <span class="octave-dots above" aria-hidden="true">${offset>0?dots:""}</span>
    <span class="note-number" aria-hidden="true">${NUMBER_NAMES[n.name]}</span>
    <span class="octave-dots below" aria-hidden="true">${offset<0?dots:""}</span>
  </span>`;
}

let audioCtx=null;
function initAudio(){
  if(!audioCtx || audioCtx.state==="closed") audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state!=="running") audioCtx.resume().catch(()=>{});
  return audioCtx;
}
function playMidi(midi){
  initAudio();
  const now=audioCtx.currentTime;
  const f=440*Math.pow(2,(midi-69)/12);
  const volume=clamp(Number(state.settings.volume??70),0,100)/100;
  if(volume===0) return;
  const master=audioCtx.createGain();
  master.gain.setValueAtTime(0.0001,now);
  master.gain.exponentialRampToValueAtTime(.4*volume,now+.015);
  master.gain.exponentialRampToValueAtTime(.0001,now+1.45);
  master.connect(audioCtx.destination);
  [1,2,3].forEach((mul,idx)=>{
    const osc=audioCtx.createOscillator();
    const g=audioCtx.createGain();
    osc.type=idx===0?"triangle":"sine";
    osc.frequency.value=f*mul;
    g.gain.value=[1,.22,.08][idx];
    osc.connect(g);g.connect(master);
    osc.start(now);osc.stop(now+1.5);
  });
}

function noteStepTreble(n){
  // E4 bottom line = 0, every diatonic step = half a staff-space.
  const diatonic=n.octave*7+NOTE_NAMES.indexOf(n.name);
  const e4=4*7+NOTE_NAMES.indexOf("E");
  return diatonic-e4;
}
function noteStepBass(n){
  // G2 bottom line = 0
  const diatonic=n.octave*7+NOTE_NAMES.indexOf(n.name);
  const g2=2*7+NOTE_NAMES.indexOf("G");
  return diatonic-g2;
}
function staffSvg(n){
  const staff=staffOf(n)||"treble";
  const step=staff==="treble"?noteStepTreble(n):noteStepBass(n);
  const lineGap=22, half=lineGap/2, bottomY=176;
  const y=bottomY-step*half;
  const lines=[0,1,2,3,4].map(i=>`<line x1="70" y1="${bottomY-i*lineGap}" x2="330" y2="${bottomY-i*lineGap}" stroke="#252522" stroke-width="2"/>`).join("");
  const clef=staff==="treble"?"𝄞":"𝄢";
  const clefY=staff==="treble"?170:161;
  const ledgers=[];
  if(step<0){for(let s=-2;s>=step;s-=2){ledgers.push(bottomY-s*half)}}
  if(step>8){for(let s=10;s<=step;s+=2){ledgers.push(bottomY-s*half)}}
  // middle C ledger can be step -2 in treble or 12 in bass
  const ledgerLines=ledgers.map(ly=>`<line x1="184" y1="${ly}" x2="238" y2="${ly}" stroke="#252522" stroke-width="2"/>`).join("");
  return `<svg viewBox="0 0 400 230" role="img" aria-label="五线谱音符">
    ${lines}
    <text x="82" y="${clefY}" font-size="${staff==="treble"?88:70}" font-family="serif">${clef}</text>
    ${ledgerLines}
    <ellipse cx="210" cy="${y}" rx="12.5" ry="9" fill="#171715" transform="rotate(-15 210 ${y})"/>
    <line x1="220" y1="${y-2}" x2="220" y2="${y-60}" stroke="#171715" stroke-width="3"/>
  </svg>`;
}

const app=document.querySelector("#app");
let route="home", session=null;

function nav(){
  return `<nav class="bottom-nav">
    <button class="navitem ${route==="home"?"active":""}" onclick="go('home')">学习</button>
    <button class="navitem ${route==="stats"?"active":""}" onclick="go('stats')">统计</button>
    <button class="navitem ${route==="settings"?"active":""}" onclick="go('settings')">设置</button>
  </nav>`;
}
function go(r){route=r;session=null;render()}

function home(){
  ensureDay();
  const total=state.daily.sight.done+state.daily.ear.done;
  const goal=state.settings.dailyCount*2;
  const p=Math.min(100,Math.round(total/goal*100));
  return `<div class="shell">
    <div class="topline"><div class="brand">NoteTrainer</div><div></div></div>
    <section class="hero"><h1 class="hello">今天也认识几个音符吧。</h1><p class="subtitle">像背单词一样，慢慢把五线谱变成直觉。</p></section>
    <div class="progress-ring" style="--p:${p}%"><div class="progress-copy"><b>${total}</b><span>今日 / ${goal}</span></div></div>
    <button class="mode-card" onclick="startQuiz('sight')"><div><h2>识谱训练</h2><p>${state.daily.sight.done} / ${state.settings.dailyCount} · 正确率 ${pct(state.daily.sight.correct,state.daily.sight.done)}%</p></div><div class="arrow">→</div></button>
    <button class="mode-card" onclick="startQuiz('ear')"><div><h2>听力训练</h2><p>${state.daily.ear.done} / ${state.settings.dailyCount} · 正确率 ${pct(state.daily.ear.correct,state.daily.ear.done)}%</p></div><div class="arrow">→</div></button>
    <div class="stats-row">
      <div class="stat"><b>${pct(state.daily.sight.correct+state.daily.ear.correct,total)}%</b><span>今日正确率</span></div>
      <div class="stat"><b>${noteLabelHtml(weakest())}</b><span>当前最薄弱</span></div>
    </div>
    ${nav()}
  </div>`;
}
function weakest(){
  const a=availableNotes().slice().sort((x,y)=>(state.weights[y.id]??.5)-(state.weights[x.id]??.5));
  return a[0]||{id:"—"};
}
function startQuiz(mode){
  ensureDay();
  if(state.daily[mode].done>=state.settings.dailyCount){
    route="result";session={mode};render();return;
  }
  if(mode==="ear") initAudio();
  session={mode,note:null,opts:[],answered:false,selected:null,correct:null};
  route="quiz";nextQuestion(mode==="ear");
}
function nextQuestion(playImmediately=false){
  if(state.daily[session.mode].done>=state.settings.dailyCount){route="result";render();return}
  session.note=weightedPick(session.note?.id);
  session.opts=optionsFor(session.note);
  session.answered=false;session.selected=null;session.correct=null;
  render();
  if(session.mode==="ear"){
    // iOS requires the first audible source to start inside the user's tap event.
    if(playImmediately) playMidi(session.note.midi);
    else setTimeout(()=>playMidi(session.note.midi),180);
  }
}
function answer(id){
  if(session.answered)return;
  const ok=id===session.note.id;
  session.answered=true;session.selected=id;session.correct=ok;
  recordAnswer(session.mode,session.note,ok);
  render();
  if(ok) setTimeout(nextQuestion,550);
}
function optionClass(id){
  if(!session.answered)return "";
  if(id===session.note.id)return "good";
  if(id===session.selected)return "bad";
  return "dim";
}
function quiz(){
  const q=state.daily[session.mode].done+1;
  const title=session.mode==="sight"?"识谱":"听力";
  const stage=session.mode==="sight"
    ? `<div class="staff-card">${staffSvg(session.note)}</div>`
    : `<div class="audio-stage">
        <button class="play" aria-label="重复播放题目音" onclick="playMidi(${session.note.midi})">▶</button>
        <div class="replay">点击可重复播放题目音</div>
        <button class="reference-tone" onclick="playMidi(60)">中央 C（1）· 对照音 ▶</button>
        <div class="volume-control">
          <div class="volume-head"><label for="volumeSlider">音量</label><output id="volumeValue">${state.settings.volume}%</output></div>
          <input id="volumeSlider" type="range" min="0" max="100" step="1" value="${state.settings.volume}" oninput="setVolume(this.value)" aria-label="播放音量">
        </div>
      </div>`;
  const feedback=session.answered && !session.correct ? `<div class="feedback">
      <div class="title">还不熟悉</div>
      <div class="answer">正确答案是 <strong>${noteLabelHtml(session.note)}</strong>。权重已从后台提高，下次更容易再遇到它。</div>
      ${session.mode==="ear"?`<div class="compare"><button onclick="playMidi(${parseNoteId(session.selected).name ? midiOf(parseNoteId(session.selected).name,parseNoteId(session.selected).octave):0})">你的答案 ${noteLabelHtml(session.selected)} ▶</button><button onclick="playMidi(${session.note.midi})">正确答案 ${noteLabelHtml(session.note)} ▶</button></div>`:""}
      <button class="primary" onclick="nextQuestion()">继续</button>
    </div>`:"";
  return `<div class="shell">
    <div class="quiz-head"><button class="back" onclick="go('home')">← 返回</button><div class="counter">${title} · ${Math.min(q,state.settings.dailyCount)} / ${state.settings.dailyCount}</div></div>
    <div class="prompt">${session.mode==="sight"?"这是哪个音？":"你听到的是哪个音？"}</div>
    ${stage}
    <div class="options">${session.opts.map(n=>`<button class="option ${optionClass(n.id)}" aria-label="${escapeHtml(displayNoteText(n))}" onclick="answer('${n.id}')">${noteLabelHtml(n)}</button>`).join("")}</div>
    ${feedback}
  </div>`;
}
function result(){
  const m=state.daily[session.mode];
  return `<div class="shell"><div class="result">
    <div class="brand">今日完成</div>
    <div class="big">${pct(m.correct,m.done)}%</div>
    <p class="muted">${m.correct} / ${m.done} 题正确</p>
    <button class="primary" onclick="go('home')">回到首页</button>
  </div></div>`;
}
function stats(){
  const byNote={};
  state.history.forEach(h=>{
    byNote[h.note]??={total:0,wrong:0};
    byNote[h.note].total++;
    if(!h.correct)byNote[h.note].wrong++;
  });
  const weak=availableNotes().slice().sort((a,b)=>(state.weights[b.id]??.5)-(state.weights[a.id]??.5)).slice(0,10);
  return `<div class="shell">
    <div class="topline"><div class="brand">NoteTrainer</div></div>
    <h1 class="section-title">学习记录</h1><p class="section-sub">权重越高，代表越需要加强；系统会自动提高它的出题概率。</p>
    <div class="stats-row">
      <div class="stat"><b>${state.history.length}</b><span>累计作答</span></div>
      <div class="stat"><b>${state.history.filter(x=>x.correct).length}</b><span>累计答对</span></div>
    </div>
    <h2 style="margin-top:30px">需要加强</h2>
    <div class="list-card">${weak.map(n=>{
      const w=state.weights[n.id]??.5;
      const s=byNote[n.id]||{total:0,wrong:0};
      return `<div class="row"><div style="flex:1"><strong>${noteLabelHtml(n)}</strong><div class="bar"><i style="width:${Math.round(w*100)}%"></i></div><div class="meta">练习 ${s.total} 次 · 错 ${s.wrong} 次</div></div><div>${Math.round(w*100)}%</div></div>`
    }).join("")}</div>
    ${nav()}
  </div>`;
}
function settings(){
  const min=LIBRARY.find(n=>n.midi===state.settings.minMidi)||LIBRARY.find(n=>n.id==="C4");
  const max=LIBRARY.find(n=>n.midi===state.settings.maxMidi)||LIBRARY.find(n=>n.id==="C6");
  return `<div class="shell">
    <div class="topline"><div class="brand">NoteTrainer</div></div>
    <h1 class="section-title">设置</h1><p class="section-sub">第一版先练自然音。你可以控制谱号、音域和每日题量。</p>
    <div class="list-card">
      <div class="setting"><label>高音谱号 <input type="checkbox" ${state.settings.treble?"checked":""} onchange="setBool('treble',this.checked)"></label></div>
      <div class="setting"><label>低音谱号 <input type="checkbox" ${state.settings.bass?"checked":""} onchange="setBool('bass',this.checked)"></label></div>
      <div class="setting"><label>音符显示 <select onchange="setDisplayMode(this.value)">
        <option value="letter" ${state.settings.displayMode==="letter"?"selected":""}>音名（C4、D4）</option>
        <option value="number" ${state.settings.displayMode==="number"?"selected":""}>简谱（1、2、3）</option>
      </select></label><small>简谱以中央 C（C4）为不加点的 1，高低八度分别显示上点和下点。</small></div>
      <div class="setting"><label>每日每模式题量 <input type="number" min="5" max="100" step="5" value="${state.settings.dailyCount}" onchange="setCount(this.value)"></label><small>默认 20 题。改变后当天立即生效。</small></div>
      <div class="setting"><strong>练习音域</strong><div class="range-wrap">
        <select onchange="setRange('minMidi',Number(this.value))">${LIBRARY.filter(n=>n.midi<=state.settings.maxMidi).map(n=>`<option value="${n.midi}" ${n.midi===state.settings.minMidi?"selected":""}>最低 ${displayNoteText(n)}</option>`).join("")}</select>
        <select onchange="setRange('maxMidi',Number(this.value))">${LIBRARY.filter(n=>n.midi>=state.settings.minMidi).map(n=>`<option value="${n.midi}" ${n.midi===state.settings.maxMidi?"selected":""}>最高 ${displayNoteText(n)}</option>`).join("")}</select>
      </div><small>当前 ${noteLabelHtml(min)} ～ ${noteLabelHtml(max)}</small></div>
    </div>
    <button class="danger" onclick="resetProgress()">重置全部学习记录</button>
    ${nav()}
  </div>`;
}
function setBool(k,v){
  if(!v && ((k==="treble" && !state.settings.bass)||(k==="bass" && !state.settings.treble))){alert("至少保留一个谱号。");render();return}
  state.settings[k]=v;save();render()
}
function setCount(v){state.settings.dailyCount=clamp(Number(v)||20,5,100);save();render()}
function setRange(k,v){state.settings[k]=v;save();render()}
function setDisplayMode(v){state.settings.displayMode=v==="number"?"number":"letter";save();render()}
function setVolume(v){
  state.settings.volume=clamp(Number(v)||0,0,100);
  const output=document.querySelector("#volumeValue");
  if(output) output.textContent=`${state.settings.volume}%`;
  save();
}
function resetProgress(){
  if(confirm("确定清空权重、答题记录和今日进度吗？")){
    state=freshState();save();render();
  }
}
function render(){
  ensureDay();
  if(route==="home") app.innerHTML=home();
  else if(route==="quiz") app.innerHTML=quiz();
  else if(route==="result") app.innerHTML=result();
  else if(route==="stats") app.innerHTML=stats();
  else if(route==="settings") app.innerHTML=settings();
}
window.addEventListener("load",()=>{
  render();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
});

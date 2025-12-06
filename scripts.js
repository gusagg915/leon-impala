
/*
  Simulador gráfico simplificado:
  - mapa cuadriculado
  - impala en centro (0,0) mirando norte
  - león en 8 posiciones alrededor (1..8)
  - impala acciones: ver_izq, ver_der, ver_frente, beber, huir_e, huir_o
  - león acciones: avanzar, esconder, atacar
  - KB simple: mapa estadoKey -> {action: counts}
  - persistencia en localStorage
*/

// ---------- Config y util ----------
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const CELL = 52;               // tamaño del cuadro visual
const GRID = 9;                // grid NxN (odd to have center)
const CENTER = Math.floor(GRID/2);
const IMPA_COORD = {x:CENTER, y:CENTER}; // impala en el centro
const POS_MAP = {
  1: {x:CENTER, y:CENTER-2},   // norte
  2: {x:CENTER+1, y:CENTER-1},
  3: {x:CENTER+2, y:CENTER},
  4: {x:CENTER+1, y:CENTER+1},
  5: {x:CENTER, y:CENTER+2},
  6: {x:CENTER-1, y:CENTER+1},
  7: {x:CENTER-2, y:CENTER},
  8: {x:CENTER-1, y:CENTER-1}
};

const impalaActionsList = ['ver_izq','ver_der','ver_frente','beber','huir_e','huir_o'];
const lionActions = ['avanzar','esconder','atacar'];

let state = {};
let KB = {}; // estructura: key -> { action -> {trials,successes,failures} }
const LOG = document.getElementById('log');

function resetKB(){ KB = {}; saveKB(); renderKB(); }
function saveKB(){ localStorage.setItem('lion_kb', JSON.stringify(KB)); }
function loadKB(){ const s = localStorage.getItem('lion_kb'); if(s) KB = JSON.parse(s); else KB = {}; renderKB(); }
function renderKB(){ document.getElementById('kbView').textContent = JSON.stringify(KB, null, 2); }

function keyFromObs(obs){
  // obs: {posNum, impalaAction, distBucket, hidden}
  return `${obs.posNum}|${obs.impalaAction}|${obs.distBucket}|${obs.hidden?1:0}`;
}

function pushLog(txt){
  const line = document.createElement('div');
  line.textContent = txt;
  LOG.prepend(line);
  if(LOG.childElementCount>200) LOG.removeChild(LOG.lastChild);
}

// ---------- util geometría ----------
function euclid(a,b){
  return Math.hypot(a.x-b.x, a.y-b.y);
}
function distBucket(d){
  if(d<=0) return 0;
  if(d<1.5) return 1;
  if(d<3) return 2;
  return 3;
}
function getPosNumFromCoords(coord){
  for(const k in POS_MAP){
    const p = POS_MAP[k];
    if(p.x===coord.x && p.y===coord.y) return Number(k);
  }
  return '*';
}

// ---------- inicializar estado ----------
function initState(startPosOption){
  let posNum;
  if(startPosOption === 'rand'){
    const opts = Object.keys(POS_MAP);
    posNum = Number(opts[Math.floor(Math.random()*opts.length)]);
  } else posNum = Number(startPosOption);
  state = {
    lion: { pos: {...POS_MAP[posNum]}, hidden:false, attacking:false, posNum: posNum },
    impala: { pos: {...IMPA_COORD}, fleeing:false, fleeDir:null, fleeVel:1 },
    time: 1,
    lastImpala: null,
    lastLion: null,
    running:false
  };
  document.getElementById('turn').textContent = state.time;
  document.getElementById('status').textContent = 'Listo';
  document.getElementById('lastImpala').textContent = '-';
  document.getElementById('lastLion').textContent = '-';
  LOG.innerHTML = '';
  draw();
}

// ---------- dibujo ----------
function drawGrid(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#eef2f7';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // draw squares
  for(let r=0;r<GRID;r++){
    for(let c=0;c<GRID;c++){
      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(c*CELL+10, r*CELL+10, CELL, CELL);
    }
  }
}
function draw(){
  drawGrid();
  // draw impala (center)
  const imp = state.impala.pos;
  const ix = imp.x*CELL + 10 + CELL/2;
  const iy = imp.y*CELL + 10 + CELL/2;
  // impala circle
  ctx.beginPath();
  ctx.fillStyle = '#ffcc66';
  ctx.arc(ix, iy, CELL*0.28, 0, Math.PI*2);
  ctx.fill();
  // eyes / facing north indicator (triangle)
  ctx.fillStyle = '#000';
  ctx.fillRect(ix-4, iy-18, 8, 8);
  ctx.beginPath();
  ctx.moveTo(ix, iy-18);
  ctx.lineTo(ix-10, iy-8);
  ctx.lineTo(ix+10, iy-8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,0,0,0.08)'; // slight vision cone highlight
  ctx.fill();

  // draw lion
  const lion = state.lion.pos;
  const lx = lion.x*CELL + 10 + CELL/2;
  const ly = lion.y*CELL + 10 + CELL/2;
  ctx.beginPath();
  ctx.fillStyle = state.lion.hidden ? '#7b9d6f' : '#c04a2a';
  ctx.arc(lx, ly, CELL*0.28, 0, Math.PI*2);
  ctx.fill();
  // label positions 1..8
  for(const k in POS_MAP){
    const p = POS_MAP[k];
    const x = p.x*CELL + 10 + CELL/2;
    const y = p.y*CELL + 10 + CELL/2;
    ctx.fillStyle = '#0f172a';
    ctx.font = '12px Arial';
    ctx.fillText(k, x-4, y+4);
  }

  // draw lines showing impala's vision depending last action
  if(state.lastImpala){
    ctx.save();
    ctx.translate(ix, iy);
    ctx.fillStyle = 'rgba(255,0,0,0.08)';
    if(state.lastImpala === 'ver_frente'){
      ctx.beginPath();
      ctx.moveTo(0,-10);
      ctx.arc(0,0, CELL*2.8, -Math.PI/4 - Math.PI/2, Math.PI/4 - Math.PI/2);
      ctx.lineTo(0,0);
      ctx.fill();
    } else if(state.lastImpala === 'ver_izq'){
      ctx.beginPath();
      ctx.moveTo(0,-10);
      ctx.arc(0,0, CELL*2.8, -Math.PI/4 - Math.PI, Math.PI/4 - Math.PI);
      ctx.lineTo(0,0);
      ctx.fill();
    } else if(state.lastImpala === 'ver_der'){
      ctx.beginPath();
      ctx.moveTo(0,-10);
      ctx.arc(0,0, CELL*2.8, -Math.PI/4, Math.PI/4);
      ctx.lineTo(0,0);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------- percepciones y reglas ----------
function impalaSees(lionPos, impalaAction, lionHidden){
  if(lionHidden) return false;
  // compute vector from impala to lion
  const dx = lionPos.x - state.impala.pos.x;
  const dy = lionPos.y - state.impala.pos.y;
  const ang = Math.atan2(dy, dx) * 180/Math.PI; // deg from +x axis
  // impala faces north => 90 deg
  let rel = (ang - 90 + 360) % 360; // relative angle 0..360 where 0 is front
  if(impalaAction === 'ver_frente'){
    return (rel <= 45 || rel >= 315);
  } else if(impalaAction === 'ver_izq'){
    return (rel > 45 && rel <= 135);
  } else if(impalaAction === 'ver_der'){
    return (rel >= 225 && rel < 315);
  }
  // beber -> sees only reflection (we assume cannot see lion)
  return false;
}

function selectActionFromKB(obs, eps=0.12){
  const key = keyFromObs(obs);
  const entry = KB[key];
  if(!entry || Math.random() < eps){
    // explorar
    return lionActions[Math.floor(Math.random()*lionActions.length)];
  }
  // elegir la acción con mayor tasa éxito (successes/trials)
  let best = null, bestRate = -1;
  for(const a in entry){
    const s = entry[a];
    const trials = s.trials || 0;
    const succ = s.successes || 0;
    const rate = trials>0 ? succ/trials : 0;
    if(rate > bestRate){
      bestRate = rate; best = a;
    }
  }
  return best || lionActions[Math.floor(Math.random()*lionActions.length)];
}

function updateKB(obs, action, success){
  const key = keyFromObs(obs);
  if(!KB[key]) KB[key] = {};
  if(!KB[key][action]) KB[key][action] = {trials:0, successes:0, failures:0};
  KB[key][action].trials += 1;
  if(success) KB[key][action].successes += 1;
  else KB[key][action].failures += 1;
  saveKB();
  renderKB();
}

// ---------- dinámica ----------
function impalaStep(impAction){
  if(state.impala.fleeing){
    // move horizontally according fleeDir (E +x, W -x) by fleeVel cells
    const v = state.impala.fleeVel;
    if(state.impala.fleeDir === 'E') state.impala.pos.x += v;
    else state.impala.pos.x -= v;
    state.impala.fleeVel += 1;
    return;
  }
  // if impAction is huir_e / huir_o start fleeing immediately
  if(impAction === 'huir_e' || impAction === 'huir_o'){
    state.impala.fleeing = true;
    state.impala.fleeDir = impAction === 'huir_e' ? 'E' : 'W';
    state.impala.fleeVel = 1;
    // move first step
    if(state.impala.fleeDir === 'E') state.impala.pos.x += 1;
    else state.impala.pos.x -= 1;
  }
  // otherwise no position change
}

function lionAdvanceTowardsImpala(){
  const lp = state.lion.pos;
  const ip = state.impala.pos;
  const dx = ip.x - lp.x;
  const dy = ip.y - lp.y;
  // move 1 cell in dominant axis
  if(Math.abs(dx) >= Math.abs(dy)){
    state.lion.pos.x += (dx>0?1:(dx<0?-1:0));
  } else {
    state.lion.pos.y += (dy>0?1:(dy<0?-1:0));
  }
}

function stepOnce(){
  if(state.running) return;
  // 1) impala decides
  let impalaMode = document.getElementById('impalaMode').value;
  let impAction;
  if(state.impala.fleeing){
    impAction = 'huir';
  } else if(impalaMode === 'aleatorio'){
    impAction = impalaActionsList[Math.floor(Math.random()*impalaActionsList.length)];
  } else {
    // programado
    const seq = document.getElementById('progSeq').value.split(',').map(s=>s.trim()).filter(s=>s);
    if(seq.length===0) impAction = 'ver_frente';
    else impAction = seq[(state.time-1) % seq.length];
  }

  // Apply impala step (movement if fleeing)
  impalaStep(impAction);
  state.lastImpala = impAction;

  // 2) lion observes
  const lp = state.lion.pos;
  const d = euclid(lp, state.impala.pos);
  const obs = {
    posNum: getPosNumFromCoords(lp),
    impalaAction: state.impala.fleeing ? 'huir' : impAction,
    distBucket: distBucket(d),
    hidden: state.lion.hidden
  };

  // 3) decide lion action (can't change if already attacking)
  let lionAction;
  if(state.lion.attacking) lionAction = 'atacar';
  else lionAction = selectActionFromKB(obs);

  // 4) apply lion action
  if(lionAction === 'avanzar'){
    lionAdvanceTowardsImpala();
    state.lion.hidden = false;
  } else if(lionAction === 'esconder'){
    state.lion.hidden = true;
  } else if(lionAction === 'atacar'){
    state.lion.attacking = true;
    // attack speed 2 cuadros/T: do two advances
    lionAdvanceTowardsImpala();
    lionAdvanceTowardsImpala();
  }

  state.lastLion = lionAction;

  // 5) check impala flee triggers (if not already fleeing)
  if(!state.impala.fleeing){
    const sees = impalaSees(state.lion.pos, impAction, state.lion.hidden);
    if(sees || lionAction === 'atacar' || euclid(state.lion.pos, state.impala.pos) < 3){
      state.impala.fleeing = true;
      // choose flee direction by x comparison: if impala.x <= lion.x -> E else W (as a simple heuristic)
      state.impala.fleeDir = (state.impala.pos.x <= state.lion.pos.x) ? 'E' : 'W';
      state.impala.fleeVel = 1;
    }
  }

  // 6) evaluate terminal:
  // success: lion reaches impala (same cell)
  const reached = (state.lion.pos.x === state.impala.pos.x && state.lion.pos.y === state.impala.pos.y);
  if(reached){
    updateKB(obs, lionAction, true);
    pushLog(`T=${state.time}: ÉXITO -> impala alcanzado. (impala=${state.lastImpala}, león=${state.lastLion})`);
    document.getElementById('status').textContent = 'Éxito';
    document.getElementById('lastImpala').textContent = state.lastImpala;
    document.getElementById('lastLion').textContent = state.lastLion;
    draw();
    return true;
  }

  // failure: impala flees out of bounds or flees this turn (we mark as failure when impala starts fleeing due to seeing)
  if(state.impala.fleeing){
    // we consider this a failure for the action that preceded the flee
    updateKB(obs, lionAction, false);
    pushLog(`T=${state.time}: Fracaso -> impala huyó. (impala=${state.lastImpala}, león=${state.lastLion})`);
    document.getElementById('status').textContent = 'Fracaso: impala huyó';
    document.getElementById('lastImpala').textContent = state.lastImpala;
    document.getElementById('lastLion').textContent = state.lastLion;
    draw();
    return true;
  }

  // no terminal yet: record no immediate success/failure for this step (we can still update KB after terminal)
  // but for simple learning update we add a trial with no success yet (soft update)
  updateKB(obs, lionAction, false); // penalize until success comes (simple approach)
  state.time += 1;
  document.getElementById('turn').textContent = state.time;
  document.getElementById('status').textContent = 'En curso';
  document.getElementById('lastImpala').textContent = state.lastImpala;
  document.getElementById('lastLion').textContent = state.lastLion;
  draw();
  return false;
}

// ---------- interacción UI ----------
document.getElementById('btnReset').addEventListener('click', ()=>{
  const sp = document.getElementById('startPos').value;
  initState(sp);
  pushLog('Estado reiniciado.');
});

document.getElementById('btnStep').addEventListener('click', ()=>{
  const done = stepOnce();
  if(done) {
    // nothing
  }
});

document.getElementById('btnRun').addEventListener('click', ()=>{
  // run until terminal or 200 steps
  state.running = true;
  document.getElementById('status').textContent = 'Ejecutando...';
  let steps = 0;
  function loop(){
    if(steps++ > 300){ state.running=false; document.getElementById('status').textContent='Detenido (límite)'; return;}
    const done = stepOnce();
    if(done){ state.running=false; return; }
    setTimeout(loop, 120);
  }
  loop();
});

document.getElementById('btnTrain').addEventListener('click', ()=>{
  // Entrenamiento rápido: ejecutar muchas incursiones con posiciones aleatorias
  const N = 1000;
  pushLog(`Iniciando entrenamiento de ${N} incursiones (rápido)...`);
  // run synchronous quick simulations (no drawing)
  for(let i=0;i<N;i++){
    // init random start among allowed (respect selection)
    const startOpt = document.getElementById('startPos').value;
    const s = (startOpt==='rand') ? 'rand' : startOpt;
    initState(s);
    // simulate until terminal but with random impala actions (fast)
    let iter=0;
    while(true && iter<200){
      iter++;
      const done = stepOnce();
      if(done) break;
    }
  }
  pushLog('Entrenamiento terminado.');
});

document.getElementById('btnShowKB').addEventListener('click', ()=>{
  renderKB();
  pushLog('Mostrando KB (resumen).');
});

document.getElementById('btnSaveKB').addEventListener('click', ()=>{
  saveKB();
  pushLog('KB guardada en localStorage.');
});

document.getElementById('btnLoadKB').addEventListener('click', ()=>{
  loadKB();
  pushLog('KB cargada desde localStorage.');
});

// impala mode toggle
document.getElementById('impalaMode').addEventListener('change', (e)=>{
  if(e.target.value === 'programado') document.getElementById('progLabel').style.display = 'block';
  else document.getElementById('progLabel').style.display = 'none';
});

// ---------- arranque ----------
loadKB();
initState('rand');
draw();

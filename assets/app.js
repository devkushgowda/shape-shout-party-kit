function printKit(group){
  resetPrintState();
  if(group){ document.body.setAttribute('data-print', group); }
  game.printPending = true;
  window.print();
}

/* Chromium fires afterprint while the preview dialog is STILL OPEN, and
   changing any print setting (paper size, scale…) re-renders the preview
   from the live DOM. So we must NOT clean up on afterprint — the ceremony
   would flip to the whole site mid-dialog. Instead, print state stays in
   the DOM (invisible on screen) and is reset at the start of the NEXT
   print. beforeprint catches prints we didn't start (Ctrl+P / browser
   menu) so those show the full site; the ?print= guard keeps headless
   PDF export working, since it prints without going through printKit. */
window.addEventListener('beforeprint', function(){
  if(!game.printPending && !new URLSearchParams(location.search).get('print')){
    resetPrintState();
  }
  game.printPending = false;
});
window.addEventListener('afterprint', function(){
  game.printPending = false; /* deliberately no DOM cleanup here */
});

/* ================= GAME CONSOLE ================= */
var game = {level:1, mode:null, timerId:null, used:{}, deck:[], watchStart:0, watchMs:0, scoreOpen:null, printPending:false};

(function buildDeck(){
  document.querySelectorAll('.g-cards').forEach(function(sec){
    var lv = sec.classList.contains('lv1') ? 1 : sec.classList.contains('lv2') ? 2 : 3;
    sec.querySelectorAll('.shapecard').forEach(function(card){
      game.deck.push({
        level: lv,
        id: card.querySelector('.id').textContent,
        svg: card.querySelector('svg').outerHTML
      });
    });
  });
})();

function beep(freq, dur, times){
  try{
    var ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    for(var i = 0; i < times; i++){
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      var t = ctx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }catch(e){ /* no audio available — timers still work silently */ }
}

function readSecs(id, fallback){
  var el = document.getElementById(id);
  var v = parseInt(el.value, 10);
  if(!(v > 0)){ v = fallback; el.value = fallback; }
  return v;
}

function setLevel(n){
  game.level = n;
  document.querySelectorAll('#levelChips .chip').forEach(function(c){
    c.setAttribute('aria-pressed', String(parseInt(c.getAttribute('data-level'), 10) === n));
  });
}

/* Deal without repeats until the chosen pool is exhausted, then reshuffle. */
function drawFromDeck(){
  var pool = game.deck.filter(function(c){ return game.level === 0 || c.level === game.level; });
  var used = game.used[game.level] || (game.used[game.level] = []);
  var fresh = pool.filter(function(c){ return used.indexOf(c.id) < 0; });
  if(!fresh.length){ used.length = 0; fresh = pool; }
  var card = fresh[Math.floor(Math.random() * fresh.length)];
  used.push(card.id);
  return card;
}

function clearTick(){ if(game.timerId){ clearInterval(game.timerId); game.timerId = null; } }

/* Timestamp-based so the countdown never drifts, even in throttled tabs. */
function runCountdown(secs, el, phase, onDone){
  clearTick();
  var end = Date.now() + secs * 1000;
  var lastShown = null;
  el.setAttribute('data-phase', phase);
  var tick = function(){
    var left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if(left !== lastShown){
      lastShown = left;
      el.textContent = left + 's';
      if(left <= 3 && left > 0){ beep(1200, 0.06, 1); }
    }
    if(left <= 0){ clearTick(); onDone(); }
  };
  tick();
  game.timerId = setInterval(tick, 200);
}

function setStatus(t){ document.getElementById('timerPhase').textContent = t; }
function setMsg(t){ document.getElementById('foMsg').textContent = t; }

/* Stop whatever is running — flash round, timer, or stopwatch. */
function stopAll(){
  clearTick();
  document.getElementById('flashOverlay').hidden = true;
  document.body.style.overflow = '';
  document.getElementById('timerBtn').textContent = '⏱ Timer only';
  document.getElementById('watchBtn').textContent = '⏲ Stopwatch';
  game.mode = null;
  var clock = document.getElementById('timerClock');
  clock.textContent = '—'; clock.removeAttribute('data-phase');
}

/* Flash round: peek the card on screen, hide it for the draw, reveal to score.
   With "keep card" checked, the card stays visible the whole round. */
function startFlashRound(){
  stopAll();
  game.mode = 'flash';
  var card = drawFromDeck();
  var keep = document.getElementById('keepCard').checked;
  var stage = document.getElementById('foStage');
  var count = document.getElementById('foCount');
  document.getElementById('foTag').textContent = card.id + ' · LEVEL ' + card.level;
  document.getElementById('foAgain').hidden = true;
  document.getElementById('flashOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  stage.innerHTML = card.svg;
  setMsg(keep ? 'Easy mode — the card stays on screen for the whole round. Get ready…'
              : 'GUIDE ONLY — memorize the shapes, sizes and positions!');
  beep(660, 0.15, 1);
  runCountdown(readSecs('peekSecs', 10), count, 'peek', function(){
    if(keep){
      setMsg('DRAW & SHOUT! The card stays up — describe away, shapes only.');
    }else{
      stage.innerHTML = '<div class="fo-big">🗣️ ✏️</div>';
      setMsg('DRAW & SHOUT! Shapes only — real-world words cost a point.');
    }
    beep(880, 0.18, 2);
    runCountdown(readSecs('drawSecs', 60), count, 'draw', function(){
      stage.innerHTML = card.svg;
      setMsg('MARKERS DOWN! Line up all three drawings and score it — this was ' + card.id + '.');
      count.textContent = '🎉';
      count.removeAttribute('data-phase');
      document.getElementById('foAgain').hidden = false;
      game.mode = null;
      beep(440, 0.4, 3);
    });
  });
}

function endFlashRound(){ stopAll(); }

document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && !document.getElementById('flashOverlay').hidden){ endFlashRound(); }
});

/* Timer only, for tables playing with printed cards. */
function toggleTimer(){
  if(game.mode === 'timer'){ stopAll(); setStatus('Stopped — set your pace and go again!'); return; }
  stopAll();
  game.mode = 'timer';
  document.getElementById('timerBtn').textContent = '■ Stop timer';
  var clock = document.getElementById('timerClock');
  setStatus('PEEK! Guide, study that card…');
  beep(660, 0.15, 1);
  runCountdown(readSecs('peekSecs', 10), clock, 'peek', function(){
    setStatus('DRAW & SHOUT! Shapes only!');
    beep(880, 0.18, 2);
    runCountdown(readSecs('drawSecs', 60), clock, 'draw', function(){
      beep(440, 0.4, 3);
      stopAll();
      setStatus('MARKERS DOWN! Flip the card, compare, score. 🎉');
    });
  });
}

/* Stopwatch: counts up instead of down, and the result can be saved to a team. */
function fmtSecs(ms){ return (ms / 1000).toFixed(1) + ' s'; }

function toggleWatch(){
  if(game.mode === 'watch'){
    var ms = Date.now() - game.watchStart;
    stopAll();
    game.watchMs = ms;
    document.getElementById('timerClock').textContent = fmtSecs(ms);
    setStatus('Time on the clock! Save it to a team below, or just brag.');
    beep(440, 0.3, 2);
    if(party.teams.length){
      document.getElementById('watchResult').textContent = fmtSecs(ms);
      refreshTeamSelect('watchTeam');
      document.getElementById('watchSave').hidden = false;
    }
    return;
  }
  stopAll();
  game.mode = 'watch';
  game.watchStart = Date.now();
  document.getElementById('watchBtn').textContent = '■ Stop & record';
  document.getElementById('watchSave').hidden = true;
  var clock = document.getElementById('timerClock');
  clock.setAttribute('data-phase', 'draw');
  clock.textContent = '0.0 s';
  setStatus('Stopwatch running — counting UP. Go go go!');
  beep(660, 0.15, 1);
  game.timerId = setInterval(function(){
    clock.textContent = fmtSecs(Date.now() - game.watchStart);
  }, 100);
}

function saveWatchTime(){
  var sel = document.getElementById('watchTeam');
  var team = party.teams.find(function(t){ return t.id === sel.value; });
  if(!team || !game.watchMs){ return; }
  if(team.bestMs == null || game.watchMs < team.bestMs){ team.bestMs = game.watchMs; }
  saveParty();
  renderParty();
  document.getElementById('watchSave').hidden = true;
  setStatus('Saved ' + fmtSecs(game.watchMs) + ' for “' + team.name + '” — best time kept.');
}

/* ================= PARTY: teams, scores, leaderboard =================
   Stored in localStorage on this device only. */
var PARTY_KEY = 'shapeShoutParty.v1';
var party = loadParty();

function loadParty(){
  var p = null;
  try{ p = JSON.parse(localStorage.getItem(PARTY_KEY)); }
  catch(e){ /* corrupted or unavailable storage — start fresh */ }
  if(!p || Object.prototype.toString.call(p.teams) !== '[object Array]'){ p = {teams: []}; }
  if(!p.awards || typeof p.awards !== 'object'){ p.awards = {}; }
  if(typeof p.groupPhoto !== 'string'){ p.groupPhoto = null; }
  p.teams.forEach(function(t){
    if(Object.prototype.toString.call(t.history) !== '[object Array]'){ t.history = []; }
    if(typeof t.photo !== 'string'){ t.photo = null; }
    t.points = t.points || 0;
    t.rounds = t.rounds || 0;
  });
  return p;
}

function saveParty(){
  try{ localStorage.setItem(PARTY_KEY, JSON.stringify(party)); return true; }
  catch(e){ return false; } /* usually QuotaExceeded — photos are the heavy part */
}

function hint(msg){
  var elx = document.getElementById('lbHint');
  elx.textContent = msg;
  clearTimeout(hint.t);
  if(msg){ hint.t = setTimeout(function(){ elx.textContent = ''; }, 4000); }
}

function addTeam(){
  var nameEl = document.getElementById('teamName');
  var playersEl = document.getElementById('teamPlayers');
  var name = nameEl.value.trim();
  if(!name){ hint('Give the team a name first!'); nameEl.focus(); return; }
  var exists = party.teams.some(function(t){ return t.name.toLowerCase() === name.toLowerCase(); });
  if(exists){ hint('“' + name + '” is already on the board — pick another name.'); return; }
  party.teams.push({
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name, players: playersEl.value.trim(), points: 0, rounds: 0, bestMs: null
  });
  nameEl.value = ''; playersEl.value = ''; nameEl.focus();
  saveParty(); renderParty(); hint('');
}

function clampInt(v, lo, hi){
  v = parseInt(v, 10);
  if(isNaN(v)){ v = 0; }
  return Math.min(hi, Math.max(lo, v));
}

function toggleScoreDrawer(teamId){
  game.scoreOpen = game.scoreOpen === teamId ? null : teamId;
  renderParty();
}

/* Digital scorecard: same math as the paper one — memory + precision + vibe − penalties. */
function scoreRound(team, m, p, v, x){
  m = clampInt(m, 0, 99); p = clampInt(p, 0, 99); v = clampInt(v, 0, 5); x = clampInt(x, 0, 99);
  var total = m + p + v - x;
  team.points += total;
  team.rounds += 1;
  team.history.push({m: m, p: p, v: v, x: x, t: total});
  game.scoreOpen = null;
  saveParty(); renderParty();
  hint('Round saved for “' + team.name + '”: ' + (total >= 0 ? '+' : '') + total + ' pts.');
}

function renameTeam(team){
  var name = prompt('Rename team:', team.name);
  if(name == null){ return; }
  name = name.trim().slice(0, 28);
  if(!name){ return; }
  team.name = name;
  saveParty(); renderParty();
}

function removeTeam(team){
  if(!confirm('Remove team “' + team.name + '” and their scores?')){ return; }
  party.teams = party.teams.filter(function(t){ return t.id !== team.id; });
  Object.keys(party.awards).forEach(function(k){
    if(party.awards[k] === team.id){ delete party.awards[k]; }
  });
  saveParty(); renderParty();
}

function resetParty(){
  if(!party.teams.length && !party.groupPhoto){ hint('Nothing to reset — the board is already empty.'); return; }
  if(!confirm('Reset the party? This clears all teams, scores, photos and award picks on this device.')){ return; }
  party = {teams: [], awards: {}, groupPhoto: null};
  game.scoreOpen = null;
  saveParty(); renderParty();
}

function rankedTeams(){
  return party.teams.slice().sort(function(a, b){
    if(b.points !== a.points){ return b.points - a.points; }
    var at = a.bestMs == null ? Infinity : a.bestMs;
    var bt = b.bestMs == null ? Infinity : b.bestMs;
    if(at !== bt){ return at - bt; }
    return a.name.localeCompare(b.name);
  });
}

/* Rows are built with textContent only, so names can never inject markup. */
function mk(tag, cls, text){
  var n = document.createElement(tag);
  if(cls){ n.className = cls; }
  if(text != null){ n.textContent = text; }
  return n;
}

function numField(label, max){
  var wrap = mk('label', 'sc-f');
  wrap.appendChild(mk('span', null, label));
  var inp = mk('input', 'sc-n');
  inp.type = 'number'; inp.min = '0'; inp.value = '0';
  if(max){ inp.max = String(max); }
  wrap.appendChild(inp);
  return {wrap: wrap, inp: inp};
}

function renderParty(){
  var list = document.getElementById('lbList');
  list.textContent = '';
  var ranked = rankedTeams();
  document.getElementById('lbEmpty').hidden = ranked.length > 0;
  ranked.forEach(function(team, i){
    var isTop = i === 0 && team.points > 0;
    var row = mk('li', 'lb-row' + (isTop ? ' top' : ''));
    row.appendChild(mk('span', 'lb-rank', String(i + 1)));
    if(team.photo){
      var th = mk('img', 'lb-photo');
      th.src = team.photo; th.alt = 'Photo of ' + team.name;
      row.appendChild(th);
    }
    var who = mk('div', 'lb-who');
    who.appendChild(mk('span', 'lb-name', (isTop ? '👑 ' : '') + team.name));
    if(team.players){ who.appendChild(mk('span', 'lb-players', team.players)); }
    row.appendChild(who);
    var stats = team.points + ' pts · ' + team.rounds + (team.rounds === 1 ? ' round' : ' rounds');
    if(team.bestMs != null){ stats += ' · best ' + fmtSecs(team.bestMs); }
    row.appendChild(mk('span', 'lb-stats', stats));
    var act = mk('div', 'lb-act');
    var cam = mk('button', 'icobtn', '📷');
    cam.title = team.photo ? 'Retake team photo' : 'Add a photo of this Guide & Artist';
    cam.onclick = function(){ setTeamPhoto(team); };
    var sc = mk('button', 'icobtn ok', '＋');
    sc.title = 'Score this round'; sc.setAttribute('aria-label', 'Score a round for ' + team.name);
    sc.onclick = function(){ toggleScoreDrawer(team.id); };
    var ren = mk('button', 'icobtn', '✎'); ren.title = 'Rename team'; ren.onclick = function(){ renameTeam(team); };
    var del = mk('button', 'icobtn del', '✕'); del.title = 'Remove team'; del.onclick = function(){ removeTeam(team); };
    act.appendChild(cam); act.appendChild(sc); act.appendChild(ren); act.appendChild(del);
    row.appendChild(act);
    if(game.scoreOpen === team.id){
      var drawer = mk('div', 'lb-score');
      var m = numField('Memory'), p = numField('Precision'), v = numField('Vibe (1–5)', 5), x = numField('Penalties');
      drawer.appendChild(m.wrap); drawer.appendChild(p.wrap); drawer.appendChild(v.wrap); drawer.appendChild(x.wrap);
      var save = mk('button', 'btn-alt', '✓ Save round');
      save.onclick = function(){ scoreRound(team, m.inp.value, p.inp.value, v.inp.value, x.inp.value); };
      drawer.appendChild(save);
      row.appendChild(drawer);
      setTimeout(function(){ m.inp.focus(); m.inp.select(); }, 0);
    }
    list.appendChild(row);
  });
  refreshTeamSelect('awardTeam');
  refreshTeamSelect('watchTeam');
  if(!party.teams.length){ document.getElementById('watchSave').hidden = true; }
  renderFinale();
}

function refreshTeamSelect(id){
  var sel = document.getElementById(id);
  var prev = sel.value;
  sel.textContent = '';
  if(!party.teams.length){
    var o = mk('option', null, '— add a team above —'); o.value = '';
    sel.appendChild(o);
    return;
  }
  rankedTeams().forEach(function(t){
    var o = mk('option', null, t.name); o.value = t.id;
    sel.appendChild(o);
  });
  if(prev && party.teams.some(function(t){ return t.id === prev; })){ sel.value = prev; }
}

/* ================= PHOTOS ================= */

/* Open the device camera (mobile) or file picker, downscale to a
   storage-friendly JPEG data URL, and hand it back. */
function pickPhoto(cb){
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = function(){
    var f = inp.files && inp.files[0];
    if(!f){ return; }
    var img = new Image();
    var url = URL.createObjectURL(f);
    img.onload = function(){
      var max = 900;
      var s = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = function(){ URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  };
  inp.click();
}

function setTeamPhoto(team){
  pickPhoto(function(data){
    if(!data){ hint('Could not read that image — try another one.'); return; }
    var prev = team.photo;
    team.photo = data;
    if(!saveParty()){
      team.photo = prev;
      hint('Storage is full — remove a photo or two and try again.');
      return;
    }
    renderParty();
    hint('Say cheese! Photo saved for “' + team.name + '”.');
  });
}

function cerHint(msg){
  var elx = document.getElementById('ceremonyHint');
  elx.textContent = msg;
  clearTimeout(cerHint.t);
  if(msg){ cerHint.t = setTimeout(function(){ elx.textContent = ''; }, 4000); }
}

function setGroupPhoto(){
  pickPhoto(function(data){
    if(!data){ cerHint('Could not read that image — try another one.'); return; }
    var prev = party.groupPhoto;
    party.groupPhoto = data;
    if(!saveParty()){
      party.groupPhoto = prev;
      cerHint('Storage is full — remove a photo or two and try again.');
      return;
    }
    renderFinale();
  });
}

function removeGroupPhoto(){
  if(!confirm('Remove the group picture?')){ return; }
  party.groupPhoto = null;
  saveParty(); renderFinale();
}

/* ================= FINALE: group photo + awards ceremony ================= */
var awardList = [];

function renderFinale(){
  var box = document.getElementById('groupPhotoBox');
  box.textContent = '';
  if(party.groupPhoto){
    var img = mk('img');
    img.src = party.groupPhoto; img.alt = 'Party group picture';
    box.appendChild(img);
    var actions = mk('div', 'gp-actions');
    var retake = mk('button', 'btn-alt', '📸 Retake'); retake.onclick = setGroupPhoto;
    var rem = mk('button', 'btn-alt', '✕ Remove'); rem.onclick = removeGroupPhoto;
    actions.appendChild(retake); actions.appendChild(rem);
    box.appendChild(actions);
  }else{
    var add = mk('button', 'btn-alt', '📸 Take / add the group picture');
    add.onclick = setGroupPhoto;
    box.appendChild(add);
    box.appendChild(mk('span', 'lb-players', 'Everyone in frame — pads up!'));
  }
  var list = document.getElementById('ceremonyList');
  list.textContent = '';
  awardList.forEach(function(a){
    var row = mk('div', 'cer-row');
    row.appendChild(mk('span', 't', a.title));
    var sel = mk('select');
    sel.setAttribute('aria-label', 'Team for ' + a.title);
    var none = mk('option', null, '— nobody yet —'); none.value = '';
    sel.appendChild(none);
    rankedTeams().forEach(function(t){
      var o = mk('option', null, t.name); o.value = t.id;
      sel.appendChild(o);
    });
    sel.value = party.awards[a.id] && party.teams.some(function(t){ return t.id === party.awards[a.id]; })
                ? party.awards[a.id] : '';
    sel.onchange = function(){
      if(sel.value){ party.awards[a.id] = sel.value; }
      else{ delete party.awards[a.id]; }
      saveParty();
    };
    row.appendChild(sel);
    list.appendChild(row);
  });
}

/* ================= FILLED-IN AWARD PRINTING ================= */
(function initAwards(){
  var sel = document.getElementById('awardSel');
  document.querySelectorAll('.sheet.g-certs').forEach(function(sec, i){
    sec.id = 'award-' + i;
    var h2 = sec.querySelector('h2');
    var title = Array.prototype.map.call(h2.childNodes, function(n){ return n.textContent.trim(); })
                  .filter(Boolean).join(' ');
    awardList.push({id: sec.id, title: title});
    var o = document.createElement('option');
    o.value = sec.id; o.textContent = title;
    sel.appendChild(o);
    var cert = sec.querySelector('.cert');
    var photos = document.createElement('div');
    photos.className = 'cert-photos';
    cert.insertBefore(photos, cert.querySelector('.stamp'));
  });
})();

function fillCertPhotos(sec, team){
  var slot = sec.querySelector('.cert-photos');
  if(!slot){ return; }
  slot.textContent = '';
  var any = false;
  if(team && team.photo){
    var img = mk('img');
    img.src = team.photo; img.alt = 'Photo of ' + team.name;
    slot.appendChild(img);
    any = true;
  }
  slot.classList.toggle('on', any);
}

function setBoxText(sec, text){
  var box = sec.querySelector('.statline .box');
  if(!box){ return; }
  box.textContent = '';
  if(text){ box.appendChild(mk('span', 'af', text)); }
}

function fillCertForTeam(sec, team){
  var fills = sec.querySelectorAll('.names .fill');
  var parts = (team.players || '').split(/\s*[&+,\/]\s*/).filter(Boolean);
  setFillText(fills[0], (parts[0] || team.name).slice(0, 26));
  if(fills[1]){ setFillText(fills[1], (parts[1] || (parts[0] ? team.name : '')).slice(0, 26)); }
  setBoxText(sec, team.points + ' pts');
  setFillText(sec.querySelector('.signs .fill'), new Date().toLocaleDateString());
  fillCertPhotos(sec, team);
}

/* Export the whole ceremony: every assigned award, then the group-picture page. */
function printCeremony(){
  resetPrintState();
  var targets = 0;
  awardList.forEach(function(a){
    var team = party.teams.find(function(t){ return t.id === party.awards[a.id]; });
    if(!team){ return; }
    var sec = document.getElementById(a.id);
    fillCertForTeam(sec, team);
    sec.classList.add('print-target');
    targets++;
  });
  if(party.groupPhoto){
    var fin = document.querySelector('.sheet.g-finale');
    document.getElementById('finalePhoto').src = party.groupPhoto;
    setFillText(fin.querySelector('.signs .fill'), new Date().toLocaleDateString());
    fin.classList.add('print-target');
    targets++;
  }
  if(!targets){
    cerHint('Assign at least one award to a team — or add a group picture — first.');
    return;
  }
  document.body.setAttribute('data-print', 'certone');
  game.printPending = true;
  window.print();
}

function prefillAward(){
  var sel = document.getElementById('awardTeam');
  var team = party.teams.find(function(t){ return t.id === sel.value; });
  if(!team){ return; }
  var parts = (team.players || '').split(/\s*[&+,\/]\s*/).filter(Boolean);
  document.getElementById('awardName1').value = (parts[0] || team.name).slice(0, 26);
  document.getElementById('awardName2').value = (parts[1] || (parts[0] ? team.name : '')).slice(0, 26);
  document.getElementById('awardStat').value = team.points ? team.points + ' pts' : '';
}

function setFillText(fill, text){
  if(!fill){ return; }
  var af = fill.querySelector('.af');
  if(!af){ af = mk('span', 'af'); fill.appendChild(af); }
  af.textContent = text;
}

function printAward(){
  var sec = document.getElementById(document.getElementById('awardSel').value);
  if(!sec){ return; }
  resetPrintState();
  var fills = sec.querySelectorAll('.names .fill');
  setFillText(fills[0], document.getElementById('awardName1').value.trim());
  if(fills[1]){ setFillText(fills[1], document.getElementById('awardName2').value.trim()); }
  setBoxText(sec, document.getElementById('awardStat').value.trim());
  setFillText(sec.querySelector('.signs .fill'), new Date().toLocaleDateString());
  var team = party.teams.find(function(t){ return t.id === document.getElementById('awardTeam').value; });
  fillCertPhotos(sec, team);
  document.body.setAttribute('data-print', 'certone');
  sec.classList.add('print-target');
  game.printPending = true;
  window.print();
}

/* Clear every trace of a previous print setup: the data-print attribute,
   target flags, filled-in names/stats/dates, and embedded photos. */
function resetPrintState(){
  document.body.removeAttribute('data-print');
  document.querySelectorAll('.sheet.print-target').forEach(function(sec){
    sec.classList.remove('print-target');
  });
  document.querySelectorAll('.af').forEach(function(af){ af.remove(); });
  document.querySelectorAll('.cert-photos').forEach(function(slot){
    slot.textContent = '';
    slot.classList.remove('on');
  });
  var fp = document.getElementById('finalePhoto');
  if(fp){ fp.removeAttribute('src'); }
}

renderParty();
prefillAward();

'use strict';
/* Light Live — дополнения: отступы под вырезы, колесо времени, область света, поворот,
   будильник, медитация и традиции, быстрый цветной код, передача и чат светом. */

/* ===== отступы под Dynamic Island / вырез ===== */
(function safeArea() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(p);
  const upd = () => {
    const cs = getComputedStyle(p), num = k => parseFloat(cs[k]) || 0;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const port = innerHeight >= innerWidth, root = document.documentElement.style;
    let top = num('paddingTop'), left = num('paddingLeft'), right = num('paddingRight');
    // запасной вариант: на iPhone в режиме приложения система иногда отдаёт 0
    if (isIOS && standalone && port && top < 20) top = 50;
    if (isIOS && standalone && !port && left < 20 && right < 20) left = right = 44;
    root.setProperty('--st', top + 'px'); root.setProperty('--sl', left + 'px'); root.setProperty('--sr', right + 'px');
  };
  upd(); addEventListener('resize', upd); addEventListener('orientationchange', () => setTimeout(upd, 350));
})();

/* ===== диалог ===== */
let dlgResolve = null;
const showDlg = () => { $('#dlg').hidden = false; };
const hideDlg = (v = null) => { $('#dlg').hidden = true; const r = dlgResolve; dlgResolve = null; r?.(v); };
$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg') hideDlg(null); });

/* ===== колесо выбора времени (как в «Часах» iPhone) ===== */
let actx;
function tickSound() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const b = actx.createBuffer(1, 600, 44100), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 45);
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 1.2; g.gain.value = .9;
    src.buffer = b; src.connect(f).connect(g).connect(actx.destination); src.start();
  } catch {}
  navigator.vibrate?.(4);
}
function wheelCol(vals, init, unit) {
  const IH = 40, col = document.createElement('div'), sc = document.createElement('div');
  col.className = 'wcol'; sc.className = 'wscroll';
  sc.innerHTML = '<div class="wpad"></div>' + vals.map(v => `<div class="witem">${String(v).padStart(2, '0')}</div>`).join('') + '<div class="wpad"></div>';
  col.appendChild(sc);
  if (unit) { const u = document.createElement('span'); u.className = 'wunit'; u.textContent = unit; col.appendChild(u); }
  const items = [...sc.querySelectorAll('.witem')];
  let idx = Math.max(0, vals.indexOf(init));
  const paint = () => {
    const c = sc.scrollTop / IH;
    items.forEach((it, i) => {
      const d = i - c, a = clamp(d * 22, -80, 80);
      it.style.transform = `rotateX(${-a}deg)`; it.style.opacity = Math.max(.12, 1 - Math.abs(d) * .3);
    });
    const ni = clamp(Math.round(c), 0, vals.length - 1);
    if (ni !== idx) { idx = ni; tickSound(); }
  };
  sc.addEventListener('scroll', paint, { passive: true });
  sc.addEventListener('pointerdown', () => { try { actx?.resume(); } catch {} });
  sc.addEventListener('click', e => { const i = items.indexOf(e.target.closest('.witem')); if (i >= 0) sc.scrollTo({ top: i * IH, behavior: 'smooth' }); });
  requestAnimationFrame(() => { sc.scrollTop = idx * IH; paint(); });
  return { el: col, get: () => vals[idx] };
}
function openWheel(title, cols, extraHtml = '') {
  return new Promise(res => {
    dlgResolve = res;
    const body = $('#dlgBody');
    body.innerHTML = `<h2>${title}</h2>${extraHtml}<div class="wheels"><div class="wband"></div></div>
      <div class="row gap"><button class="btn ghost" data-a="x">Отмена</button><button class="btn" data-a="ok">Готово</button></div>`;
    const W = cols.map(c => wheelCol(c.vals, c.init, c.unit));
    W.forEach(w => body.querySelector('.wheels').appendChild(w.el));
    body.onclick = e => { const a = e.target.dataset.a; if (a) hideDlg(a === 'ok' ? W.map(w => w.get()) : null); };
    showDlg();
  });
}

/* ===== область света: «вырезать ножницами» часть экрана ===== */
cfg.area = S.get('area', { shape: 'full', x: .1, y: .3, w: .8, h: .4 });
const AREA_NAMES = { full: 'весь экран', rect: 'прямоугольник', round: 'скруглённая', oval: 'круг / овал', ring: 'кольцо' };
function areaCss(a) {
  const L = a.x * 100, T = a.y * 100, R = (1 - a.x - a.w) * 100, B = (1 - a.y - a.h) * 100;
  const cx = (a.x + a.w / 2) * 100, cy = (a.y + a.h / 2) * 100, ell = `ellipse(${a.w * 50}% ${a.h * 50}% at ${cx}% ${cy}%)`;
  switch (a.shape) {
    case 'rect': return [`inset(${T}% ${R}% ${B}% ${L}%)`, 'none'];
    case 'round': return [`inset(${T}% ${R}% ${B}% ${L}% round 32px)`, 'none'];
    case 'oval': return [ell, 'none'];
    case 'ring': return [ell, `radial-gradient(ellipse ${a.w * 50}% ${a.h * 50}% at ${cx}% ${cy}%, transparent 60%, #000 62%)`];
    default: return ['none', 'none'];
  }
}
function applyArea(el, a = cfg.area) {
  const [clip, mask] = areaCss(a);
  el.style.clipPath = clip; el.style.webkitClipPath = clip; el.style.maskImage = mask; el.style.webkitMaskImage = mask;
}
function renderArea() {
  applyArea(glow); applyArea($('#orb')); $('#areaName').textContent = AREA_NAMES[cfg.area.shape];
}
let edA = null;
function openAreaEditor() {
  edA = { ...cfg.area }; if (edA.shape === 'full') edA = { shape: 'round', x: .1, y: .3, w: .8, h: .4 };
  $('#areaEd').hidden = false; $('#areaLight').style.background = cfg.screenColor; drawEd();
  seg($('#areaShape'), [['rect', '▭ Прямо'], ['round', '▢ Скругл.'], ['oval', '⬭ Овал'], ['ring', '◯ Кольцо']], edA.shape, v => { edA.shape = v; drawEd(); });
  seg($('#areaPreset'), [['top', 'Верх'], ['mid', 'Центр'], ['bot', 'Низ'], ['strip', 'Полоса'], ['sq', 'Квадрат']], '', v => {
    const sq = Math.min(.8, .8 * innerWidth / innerHeight);
    Object.assign(edA, { top: { x: 0, y: 0, w: 1, h: .35 }, mid: { x: .1, y: .3, w: .8, h: .4 }, bot: { x: 0, y: .65, w: 1, h: .35 },
      strip: { x: 0, y: .44, w: 1, h: .12 }, sq: { x: (1 - .8) / 2, y: .5 - sq * innerWidth / innerHeight / 2, w: .8, h: sq * innerWidth / innerHeight } }[v]);
    drawEd();
  });
}
function drawEd() {
  const b = $('#areaBox').style;
  b.left = edA.x * 100 + '%'; b.top = edA.y * 100 + '%'; b.width = edA.w * 100 + '%'; b.height = edA.h * 100 + '%';
  $('#areaBox').className = edA.shape;
  applyArea($('#areaLight'), edA);
}
(() => {
  let drag = null;
  $('#areaEd').addEventListener('pointerdown', e => {
    if (e.target.closest('.area-ui')) return;
    const h = e.target.dataset.h || (e.target.closest('#areaBox') ? 'move' : null); if (!h) return;
    drag = { h, sx: e.clientX, sy: e.clientY, a: { ...edA } }; e.preventDefault();
    $('#areaEd').classList.add('dragging');
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / innerWidth, dy = (e.clientY - drag.sy) / innerHeight, a = drag.a, M = .08;
    let { x, y, w, h } = a;
    if (drag.h === 'move') { x = clamp(a.x + dx, 0, 1 - a.w); y = clamp(a.y + dy, 0, 1 - a.h); }
    else {
      if (drag.h.includes('w')) { x = clamp(a.x + dx, 0, a.x + a.w - M); w = a.x + a.w - x; }
      if (drag.h.includes('e')) w = clamp(a.w + dx, M, 1 - a.x);
      if (drag.h.includes('n')) { y = clamp(a.y + dy, 0, a.y + a.h - M); h = a.y + a.h - y; }
      if (drag.h.includes('s')) h = clamp(a.h + dy, M, 1 - a.y);
    }
    Object.assign(edA, { x, y, w, h }); drawEd();
  });
  addEventListener('pointerup', () => { if (drag) { drag = null; $('#areaEd').classList.remove('dragging'); } });
})();
$('#areaBtn').addEventListener('pointerdown', e => e.stopPropagation());
$('#areaBtn').onclick = openAreaEditor;
$('#areaOk').onclick = () => { cfg.area = edA; S.set('area', cfg.area); $('#areaEd').hidden = true; renderArea(); toast('✂️ Светиться будет только выбранная часть'); };
$('#areaReset').onclick = () => { cfg.area = { ...cfg.area, shape: 'full' }; S.set('area', cfg.area); $('#areaEd').hidden = true; renderArea(); toast('Светит весь экран'); };

/* ===== поворот экрана во время света ===== */
cfg.rot = S.get('rot', 'auto');
let lockedOrient = null;
const ROT_INFO = { auto: ['🔄', 'Автоповорот включён'], lock: ['🔒', 'Поворот заблокирован'], land: ['↔️', 'Всегда горизонтально'] };
async function applyRot() {
  const port = innerHeight >= innerWidth;
  if (cfg.rot !== 'lock') lockedOrient = null;
  const want = cfg.rot === 'land' ? 'landscape' : cfg.rot === 'lock' ? (lockedOrient ||= port ? 'portrait' : 'landscape') : null;
  let native = false;
  try { if (want) { await screen.orientation.lock(want); native = true; } else screen.orientation?.unlock?.(); } catch {}
  // если система не умеет блокировать (iPhone) — поворачиваем содержимое сами
  const need = !native && want && ((want === 'landscape') === (innerHeight >= innerWidth));
  const ang = screen.orientation?.angle ?? window.orientation ?? 0;
  stage.style.setProperty('--rot', want === 'landscape' ? '90deg' : (ang === 270 || ang === -90 ? '90deg' : '-90deg'));
  stage.classList.toggle('rot', !!need);
  $('#rotBtn').textContent = ROT_INFO[cfg.rot][0];
}
$('#rotBtn').onclick = () => {
  cfg.rot = { auto: 'lock', lock: 'land', land: 'auto' }[cfg.rot]; S.set('rot', cfg.rot);
  lockedOrient = null; applyRot(); toast(ROT_INFO[cfg.rot][1]); poke();
};
addEventListener('resize', () => { if (!stage.hidden) applyRot(); });
const _showStage = showStage;
showStage = function (title) { _showStage(title); applyRot(); };
let afterStop = null;
const _stopAll = stopAll;
stopAll = function () {
  _stopAll();
  try { screen.orientation?.unlock?.(); } catch {}
  stage.classList.remove('rot');
  if (afterStop) { const f = afterStop; afterStop = null; setTimeout(f, 0); }
};

/* ===== таймер и будильник для любого режима ===== */
function saveSheet(m) {
  if (m.param) { let v = $('#pIn').value; if (m.param.type === 'range') v = +v; cfg.params[m.id] = { [m.param.key]: v }; save('params'); }
  if (!m.noSpeed) { cfg.speeds[m.id] = +$('#shSpeed').value; save('speeds'); }
}
$('#shSched').onclick = () => {
  const m = sheetMode; saveSheet(m);
  let kind = 'in';
  const now = new Date(), hhmm = `${String((now.getHours() + 1) % 24).padStart(2, '0')}:00`;
  const extra = `<p class="dlg-sub">${m.name}</p><div class="seg" id="schKind"></div>
    <div id="schAt" hidden><label class="lbl">Включить ровно в</label><input type="time" id="schTime" value="${S.get('schTime', hhmm)}"></div>`;
  const p = openWheel('⏰ Запуск по времени', [{ vals: range(0, 23), init: 0, unit: 'ч' }, { vals: range(0, 59), init: 5, unit: 'мин' }, { vals: range(0, 59), init: 0, unit: 'сек' }], extra);
  seg($('#schKind'), [['in', '⏱ Через время'], ['at', '⏰ В точное время']], 'in', v => {
    kind = v; $('#schAt').hidden = v !== 'at'; $('#dlgBody .wheels').hidden = v === 'at';
  });
  const timeIn = $('#schTime');
  p.then(r => {
    if (!r) return;
    let at;
    if (kind === 'at') {
      const [h, mi] = (timeIn.value || hhmm).split(':').map(Number); S.set('schTime', timeIn.value);
      const d = new Date(); d.setHours(h, mi, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); at = d.getTime();
    } else {
      const ms = (r[0] * 3600 + r[1] * 60 + r[2]) * 1000; if (!ms) { toast('Выберите время больше нуля'); return; }
      at = Date.now() + ms;
    }
    $('#sheet').hidden = true; schedule(m.id, at);
  });
};
let waitIv = 0;
function schedule(id, at) {
  stopAll(); S.set('pending', { id, at });
  const m = modeById(id);
  $('#waitIc').innerHTML = m.ic; $('#waitName').textContent = m.name;
  $('#waitAt').textContent = 'Включится в ' + new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  $('#waitBox').hidden = false; wake(true);
  clearInterval(waitIv);
  const upd = () => {
    const left = at - Date.now();
    if (left <= 0) { clearInterval(waitIv); $('#waitBox').hidden = true; S.set('pending', null); Engine.start(m); return; }
    $('#waitTime').textContent = fmtMin(left / 60000);
  };
  upd(); waitIv = setInterval(upd, 250);
}
$('#waitCancel').onclick = () => { clearInterval(waitIv); $('#waitBox').hidden = true; S.set('pending', null); wake(false); toast('Отменено'); };

/* ===== новые режимы: медитация и отдых, религии и традиции, будильник ===== */
const PHASE = { in: 'Вдох', hold: 'Задержка', out: 'Выдох', rest: 'Пауза' };
function breathing(id, ic, name, desc, phases, c) {
  const T = phases.reduce((a, p) => a + p[1], 0);
  MODES.push({ id, cat: 'Медитация и отдых', ic, name, desc, noSpeed: true, f: (t, st, p, rt) => {
    let x = rt % T;
    for (const [k, d] of phases) {
      if (x < d) { const q = smooth(x / d), l = k === 'in' ? .06 + .94 * q : k === 'out' ? .06 + .94 * (1 - q) : k === 'hold' ? 1 : .06;
        return { l, c, label: PHASE[k] + '\n' + Math.ceil(d - x) }; }
      x -= d;
    }
    return { l: 0 };
  } });
}
breathing('med478', '🌙', 'Дыхание 4-7-8', 'Вдох 4 сек, задержка 7, выдох 8. Успокаивает и помогает уснуть', [['in', 4], ['hold', 7], ['out', 8]], '#6fa8ff');
breathing('medbox', '🟦', 'Квадратное дыхание', 'Вдох, задержка, выдох, пауза — по 4 сек. Снимает стресс', [['in', 4], ['hold', 4], ['out', 4], ['rest', 4]], '#7dffc0');
breathing('medcoh', '〰️', 'Ровное дыхание 5-5', 'Вдох 5 сек, выдох 5 сек. Выравнивает пульс и дыхание', [['in', 5], ['out', 5]], '#00d0c0');
breathing('med46', '🍃', 'Глубокое дыхание 4-6', 'Вдох 4 сек, выдох 6. Длинный выдох расслабляет', [['in', 4], ['out', 6]], '#b9a2ff');
const calm = (id, ic, name, desc, f, extra = {}) => MODES.push({ id, cat: 'Медитация и отдых', ic, name, desc, ...extra, f });
calm('ocean', '🌊', 'Спокойный океан', 'Медленные синие волны света', t => ({ l: .35 + .3 * Math.sin(t * .7) + .15 * Math.sin(t * 1.9), c: mix('#0b3d91', '#00b4d8', .5 + .5 * Math.sin(t * .3)) }));
calm('moon', '🌕', 'Лунный свет', 'Тусклый холодный свет с лёгким мерцанием', t => ({ l: .25 + .05 * noise(t * 1.5), c: '#c9d8ff' }));
calm('forest', '🌲', 'Лесная тишина', 'Мягкий зелёный, как свет сквозь листву', t => ({ l: .35 + .2 * noise(t * .8), c: mix('#1f7a3a', '#9be37a', noise(t * .25)) }));
calm('hearth', '🪵', 'Камин', 'Тёплый неяркий огонь — уютно перед сном', t => { const n = noise(t * 4) * .6 + noise(t * 1.3 + 3) * .4; return { l: .2 + .35 * n, c: mix('#b33a00', '#ff9a3c', n) }; });
calm('bowl', '🔔', 'Поющая чаша', 'Золотой свет вспыхивает и долго затихает, как звук чаши', t => { const x = t % 10; return { l: .05 + .95 * Math.exp(-x / 2.6) * (x < .15 ? x / .15 : 1), c: '#ffc24a' }; });
calm('stars', '✨', 'Звёздное небо', 'Тёмно-синий свет и редкие мерцания', (t, st) => { if (st.n == null || t > st.n + .6) st.n = t + .5 + Math.random() * 3; const d = t - st.n; return { l: .12 + (d > 0 && d < .6 ? .5 * Math.sin(d / .6 * Math.PI) : 0), c: '#24317a' }; });
calm('chakra', '🧘', 'Семь чакр', 'Семь цветов по очереди, по 20 сек на каждый', t => ({ l: .8, c: cycleColors(['#ff1a1a', '#ff8a00', '#ffe600', '#00d65c', '#00b4ff', '#3a3aff', '#9b30ff'], 20)(t) }));
calm('rain', '🌧️', 'Дождь за окном', 'Серо-голубой свет, как в дождливый вечер', t => ({ l: .3 + .12 * noise(t * 6) + .1 * noise(t * .5), c: '#7f9cb8' }));
calm('sleep20', '😴', 'Засыпание', 'Тёплый свет постепенно гаснет и выключается', (t, st, p, rt) => { const k = 1 - rt / (p.min * 60); return k <= 0 ? { l: 0, done: true } : { l: .5 * k * k, c: '#ff9a4a', label: '' }; },
  { noSpeed: true, param: { key: 'min', type: 'range', label: 'Гаснет за', min: 5, max: 60, step: 5, def: 20, unit: ' мин' } });
calm('focus', '🍅', 'Фокус 25/5', '25 мин рабочий свет, 5 мин зелёный отдых — по кругу', (t, st, p, rt) => {
  const x = rt % 1800, work = x < 1500, left = work ? 1500 - x : 1800 - x;
  return { l: work ? .9 : .5, c: work ? '#fff1dc' : '#5cff9a', label: (work ? 'Работа ' : 'Отдых ') + fmtMin(left / 60) };
}, { noSpeed: true });
calm('morning', '🌤️', 'Тёплое утро', 'Мягкий персиковый свет, едва заметно дышит', t => ({ l: .6 + .1 * Math.sin(t * .8), c: '#ffc49a' }));

const faith = (id, ic, name, desc, f) => MODES.push({ id, cat: 'Религии и традиции', ic, name, desc, f });
const gentle = c => t => ({ l: .65 + .25 * Math.sin(t * .9), c });
const flame = (a, b) => t => { const n = noise(t * 5) * .6 + noise(t * 1.7 + 4) * .4; return { l: .45 + .5 * n, c: mix(a, b, n) }; };
faith('relIslam', '☪️', 'Ислам', 'Спокойный зелёный — цвет ислама', gentle('#0a9f45'));
faith('relRamadan', '🌙', 'Рамадан', 'Ночное небо и золото полумесяца', t => ({ l: .8, c: cycleColors(['#0b1a4a', '#ffc84a'], 6)(t) }));
faith('relOrth', '🕯️', 'Православие: лампада', 'Тёплый мерцающий огонёк лампады', flame('#8b1010', '#ffb347'));
faith('relEaster', '🥚', 'Пасха', 'Белый и золотой — цвета Светлого Воскресения', t => ({ l: 1, c: cycleColors(['#ffffff', '#ffd24a'], 4)(t) }));
faith('relXmas', '🎄', 'Рождество', 'Золото и тёплые огоньки', (t, st) => { const k = Math.floor(t * 6); if (st.k !== k) { st.k = k; st.s = Math.random() < .25; } return { l: st.s ? 1 : .6, c: st.s ? '#fff4c2' : '#ffb300' }; });
faith('relAdvent', '🕯', 'Адвент', 'Фиолетовый и розовый — время ожидания Рождества', t => ({ l: .8, c: cycleColors(['#6a1b9a', '#ff7eb6'], 5)(t) }));
faith('relHanukkah', '🕎', 'Ханука', 'Синий и белый с огоньками свечей', t => { const n = noise(t * 5); return { l: .7 + .3 * n, c: mix(cycleColors(['#1a4dff', '#ffffff'], 5)(t), '#ffd27a', n * .4) }; });
faith('relBuddha', '☸️', 'Буддизм', 'Шафрановый — цвет одежд буддийских монахов', gentle('#ff9f1a'));
faith('relBflag', '🏳️', 'Буддийский флаг', 'Синий, жёлтый, красный, белый, оранжевый', t => ({ l: .9, c: cycleColors(['#1a4dff', '#ffd400', '#e8121b', '#ffffff', '#ff8a00'], 4)(t) }));
faith('relHindu', '🕉️', 'Индуизм', 'Священный шафрановый цвет', gentle('#ff7a00'));
faith('relDiwali', '🪔', 'Дивали', 'Праздник огней: золотые огоньки масляных ламп', flame('#c25a00', '#ffd76a'));
faith('relHoli', '🎨', 'Холи', 'Праздник красок: яркие цвета сменяют друг друга', t => ({ l: 1, c: cycleColors(['#ff2fa0', '#ffe600', '#00d4ff', '#7cff3a', '#ff7a00', '#9b30ff'], 1.6)(t) }));
faith('relSikh', '🪯', 'Сикхизм', 'Шафрановый и синий', t => ({ l: .9, c: cycleColors(['#ff9933', '#1a3d8f'], 5)(t) }));
faith('relNowruz', '🌱', 'Навруз', 'Весенний праздник: зелень и солнце', t => ({ l: .9, c: cycleColors(['#5cff3a', '#ffe600'], 5)(t) }));

MODES.push(
  { id: 'alarm', cat: 'Полезное', ic: '⏰', name: 'Будильник', desc: 'Яркие вспышки, чтобы проснуться. Время задаётся кнопкой ⏰', noSpeed: true,
    f: (t, st, p, rt) => { const x = rt % 1.2, burst = x < .6 && (x % .2) < .1; return { l: burst ? 1 : 0, c: '#ffffff' }; } },
  { id: 'steady', cat: 'Полезное', ic: '💡', name: 'Свет по таймеру', desc: 'Ровный яркий свет. Нажмите ⏰, чтобы включить позже', noSpeed: true, f: () => ({ l: 1 }) });
CATS.push('Медитация и отдых', 'Религии и традиции');
CATS.splice(CATS.indexOf('Медитация и отдых'), 1); CATS.splice(3, 0, 'Медитация и отдых');
for (const m of MODES) if (m.morse === undefined && ['sos', 'morse', 'help', 'ok', 'custom'].includes(m.id)) m.morse = true;

/* ===== быстрый цветной код (только Light Live ↔ Light Live, только экран) =====
   Каждый символ = 4 цветовые вспышки из 4 цветов. Соседние вспышки всегда разного цвета,
   поэтому приёмнику не нужно мерить длительности — он просто считает смены цвета. */
const CC_ALPH = ' АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-:()+"/';
const CC_COL = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'], CC_CLS = 'RGBW', CC_UNIT = .18;
function ccEncode(text) {
  const out = []; let prev = 3;
  for (const ch of String(text).toUpperCase().replace(/Ё/g, 'Е')) {
    let v = CC_ALPH.indexOf(ch); if (v < 0) v = CC_ALPH.indexOf('?');
    for (const t of [Math.floor(v / 27), Math.floor(v / 9) % 3, Math.floor(v / 3) % 3, v % 3]) { prev = (prev + 1 + t) % 4; out.push([prev, ch]); }
  }
  return out;
}
function ccDecode(syms) {
  let prev = 3, tr = [], txt = '';
  for (const s of syms) { tr.push((s - prev - 1 + 8) % 4); prev = s; }
  for (let i = 0; i + 3 < tr.length; i += 4) {
    const q = tr.slice(i, i + 4); txt += q.includes(3) ? '?' : (CC_ALPH[q[0] * 27 + q[1] * 9 + q[2] * 3 + q[3]] || '?');
  }
  if (tr.length % 4) txt += '?';
  return txt;
}
function colorCodeMode(text) {
  const syms = ccEncode(text), pre = .6, start = .45, n = syms.length, total = pre + start + n * CC_UNIT + .8;
  return { id: '_cc', name: '⚡ Цветной код', noSpeed: true, screenOnly: true, f: (t, st, p, rt) => {
    if (rt >= total) return { l: 0, done: true };
    if (rt < pre) return { l: 0 };
    if (rt < pre + start) return { l: 1, c: '#ffffff', label: '' };
    const i = Math.floor((rt - pre - start) / CC_UNIT);
    if (i >= n) return { l: 0 };
    return { l: 1, c: CC_COL[syms[i][0]], label: syms[i][1] === ' ' ? '␣' : syms[i][1] };
  } };
}
function morseOnceMode(text) {
  const items = morseItems(text), total = items.reduce((a, x) => a + x[1], 0) * U / 1000, f = seq(items, U);
  return { id: '_tx', name: '📡 Передача Морзе', morse: true, f: t => t >= total ? { l: 0, done: true } : f(t) };
}
/* приёмник цветного кода: следит за цветом в рамке параллельно с Морзе */
window.ColorRx = {
  cls: 'K', cand: null, candN: 0, candT: 0, tSeg: 0, syms: null,
  feed(t, val, rgb, lo, range) {
    let c = 'K';
    if (range >= 25 && val > lo + range * .4) {
      const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      c = mn / mx > .6 ? 'W' : r >= g && r >= b ? 'R' : g >= b ? 'G' : 'B';
    }
    if (c === this.cls) { this.cand = null; return; }
    if (this.cand !== c) { this.cand = c; this.candT = t; this.candN = 0; }
    if (++this.candN < 2) return;
    const prev = this.cls, d = this.candT - this.tSeg;
    this.cls = c; this.tSeg = this.candT; this.cand = null;
    if (this.syms && prev !== 'K') this.syms.push(CC_CLS.indexOf(prev));
    if (!this.syms && prev === 'W' && d >= 280 && c !== 'K') this.syms = [];
    if (c === 'K' && this.syms) {
      const txt = ccDecode(this.syms).trim(); this.syms = null;
      const a = Rx.L.segs; if (a.length && a[a.length - 1].s && a[a.length - 1].d > 900) Rx.L.dropLast();
      if (txt) { Rx.L.done += txt + ' '; Rx.L.onText?.(txt, 'color'); Rx.render(true); }
    }
  }
};

/* ===== отправка текста светом ===== */
let sending = false;
async function sendLight(text, proto, how, done) {
  text = text.trim(); if (!text) return;
  const m = proto === 'color' ? colorCodeMode(text) : morseOnceMode(text);
  sending = true;
  // Engine.start сам вызывает stopAll в начале — поэтому «после окончания» назначаем уже после вызова
  const p = Engine.start(m, { temp: true, target: proto === 'color' ? 'screen' : how, speed: 1, params: {}, onDone: () => {} });
  afterStop = () => { sending = false; done?.(); };
  await p;
  if (active !== 'mode') { const f = afterStop; afterStop = null; sending = false; f && f(); }
}

/* ===== подвкладка «Передать» ===== */
const noTorch = () => isIOS || Torch.supported === false;
let txProto = S.get('txProto', 'morse'), txHow = S.get('txHow', isIOS ? 'screen' : 'both');
function renderTx() {
  seg($('#txProto'), [['morse', '📡 Морзе'], ['color', '⚡ Цветной код']], txProto, v => { txProto = v; S.set('txProto', v); renderTx(); });
  const dis = noTorch() || txProto === 'color';
  if (dis) txHow = 'screen';
  seg($('#txHow'), [['screen', '⬜ Экран'], ['torch', '🔦 Вспышка', dis], ['both', '🔦+⬜ Оба', dis]], txHow, v => { txHow = v; S.set('txHow', v); });
  $('#txHint').textContent = txProto === 'color'
    ? '⚡ Цветной код в 3 раза быстрее Морзе и почти без ошибок, но прочитать его может только Light Live на другом телефоне (вкладка «Принять» или «Чат»). Работает только экраном.'
    : '📡 Морзе понимают люди и любые приёмники. Через вспышку передаётся помедленнее, чтобы не было ошибок.';
  $('#txModes').innerHTML = MODES.filter(m => m.morse).map(m => `<button class="mode" data-id="${m.id}"><span class="ic">${m.ic}</span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></button>`).join('');
}
$('#txModes').addEventListener('click', e => { const b = e.target.closest('.mode'); if (b) openSheet(modeById(b.dataset.id)); });
$('#txGo').onclick = () => { const t = $('#txIn').value; if (!t.trim()) { toast('Напишите текст'); return; } sendLight(t, txProto, txHow, () => toast('✓ Передано')); };

/* ===== чат светом ===== */
const chat = { list: S.get('chat', []), how: S.get('chatHow', 'screen'), proto: S.get('chatProto', 'morse'), on: false };
const saveChat = () => S.set('chat', chat.list.slice(-100));
const hhmm = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function renderChat() {
  const L = $('#chatList');
  L.innerHTML = (chat.list.length ? '' : `<div class="chat-empty">💬<b>Чат светом</b>Напишите сообщение — телефон передаст его вспышками. Ответ собеседника появится здесь сам.</div>`)
    + chat.list.map(m => `<div class="msg ${m.me ? 'me' : 'them'}"><div class="bubble">${esc(m.text)}<span class="meta">${m.proto === 'color' ? '⚡ ' : ''}${hhmm(m.t)}${m.me ? (m.st === 'send' ? ' · ⏳' : ' · ✓') : ''}</span></div></div>`).join('')
    + `<div class="msg them" id="chatGhost" hidden><div class="bubble ghost"></div></div>`;
  L.scrollTop = L.scrollHeight;
}
function renderChatSet() {
  const dis = noTorch();
  if (dis && chat.how === 'torch') chat.how = 'screen';
  seg($('#chatHow'), [['screen', '🤳 Экраном'], ['torch', '🔦 Вспышкой', dis]], chat.how, v => { chat.how = v; S.set('chatHow', v); if (v === 'torch' && chat.proto === 'color') chat.proto = 'morse'; renderChatSet(); chatListen(); });
  seg($('#chatProto'), [['morse', '📡 Морзе'], ['color', '⚡ Быстрый код', chat.how === 'torch']], chat.proto, v => { chat.proto = v; S.set('chatProto', v); renderChatSet(); });
  $('#chatHint').innerHTML = (chat.how === 'screen'
    ? '🤳 Держите телефоны <b>экранами друг к другу</b> (20–60 см). Передаёт экран, принимает фронтальная камера.'
    : '🔦 Направьте телефоны <b>задними камерами друг на друга</b>. Передаёт вспышка, принимает основная камера.')
    + (chat.proto === 'color' ? ' ⚡ Быстрый код читает только Light Live.' : '') + ' <a href="#" id="chatClear">Очистить чат</a>';
  $('#chatClear').onclick = e => { e.preventDefault(); chat.list = []; saveChat(); renderChat(); };
}
function chatListen() {
  if (!chat.on || sending) return;
  const want = chat.how === 'screen' ? 'user' : 'environment';
  if (Rx.stream && Rx.facing === want) return;
  Rx.facing = want; syncFlip();
  if (Rx.stream) Rx.stop();
  Rx.start();
}
function chatSend() {
  const t = $('#chatIn').value.trim(); if (!t) return;
  if (sending) { toast('Дождитесь окончания передачи'); return; }
  $('#chatIn').value = '';
  const msg = { me: true, text: t, t: Date.now(), proto: chat.proto, st: 'send' };
  chat.list.push(msg); saveChat(); renderChat();
  // пока передаём — не слушаем, чтобы не принять собственный свет
  const torch = chat.how === 'torch';
  if (torch) Rx.stop(); else Rx.paused = true;
  sendLight(t, chat.proto, chat.how, () => {
    msg.st = 'ok'; saveChat(); renderChat();
    setTimeout(() => { Rx.paused = false; if (chat.on) chatListen(); }, 700);
  });
}
$('#chatSend').onclick = chatSend;
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter') chatSend(); });
Rx.L.onText = (text, proto) => {
  if (!chat.on) return;
  chat.list.push({ me: false, text, t: Date.now(), proto: proto || 'morse' }); saveChat(); renderChat();
  navigator.vibrate?.([30, 60, 30]);
};
// «собеседник передаёт…» — распознаваемый на лету текст
const _rxRender = Rx.render;
Rx.render = function (force) {
  const before = this.lastRender; _rxRender.call(this, force);
  if (!chat.on || this.lastRender === before) return;
  const r = this.L.view(this.stream ? this.now : performance.now()), g = $('#chatGhost');
  if (!g) return;
  const cs = ColorRx.syms;
  const s = cs ? '⚡ ' + ccDecode(cs.slice(0, cs.length - cs.length % 4)) + '…' // идёт цветной код — показываем буквы по мере приёма
    : ((r.session || '') + (r.pending ? ' ' + pretty(r.pending) : '')).trim();
  g.hidden = !s; if (s) { g.firstChild.textContent = '✍️ ' + s; }
};

/* ===== камера: одна на «Принять» и «Чат» ===== */
const syncFlip = () => { $('#rxVideo').classList.toggle('mirror', Rx.facing === 'user'); };
$('#rxFlip').onclick = () => { Rx.facing = Rx.facing === 'user' ? 'environment' : 'user'; syncFlip(); if (Rx.stream) { Rx.stop(); Rx.start(); } };
let morseSub = 'chat';
window.onMorseSub = (v, listen = true) => {
  morseSub = v; chat.on = v === 'chat' && listen;
  const cam = $('#cam');
  if (v === 'chat') { $('#chatCamSlot').appendChild(cam); cam.classList.add('mini'); Rx.reg = null; renderChat(); renderChatSet(); chatListen(); }
  else if (v === 'rx') { $('#camHome').after(cam); cam.classList.remove('mini'); Rx.reg = null; if (Rx.facing === 'user' && !Rx.stream) { Rx.facing = 'environment'; syncFlip(); } }
  if (v === 'tx') renderTx();
};
document.querySelector('nav button[data-tab="morse"]').addEventListener('click', () => onMorseSub(morseSub));
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab !== 'morse') chat.on = false; }));

/* ===== запуск ===== */
renderArea(); renderModes(); renderTimers(); renderChat(); renderChatSet(); renderTx(); onMorseSub('chat', false);
(() => { // незавершённый будильник после перезапуска приложения
  const p = S.get('pending', null);
  if (p && modeById(p.id)) { if (p.at > Date.now()) schedule(p.id, p.at); else if (Date.now() - p.at < 10 * 60000) Engine.start(modeById(p.id)); else S.set('pending', null); }
})();

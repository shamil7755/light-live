'use strict';
/* ===== утилиты ===== */
const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const S = {
  get(k, d) { try { const v = localStorage.getItem('ll_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ll_' + k, JSON.stringify(v)); } catch {} }
};
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const cfg = {
  screenLvl: S.get('screenLvl', 1), torchLvl: S.get('torchLvl', 1), master: S.get('master', 1),
  screenColor: S.get('screenColor', '#ffffff'), target: S.get('target', isIOS ? 'screen' : 'both'),
  timer: S.get('timer', 0), vibrate: S.get('vibrate', true), favs: S.get('favs', []),
  last: S.get('last', null), params: S.get('params', {}), speeds: S.get('speeds', {})
};
const save = k => S.set(k, cfg[k]);
let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function noise(x) { const i = Math.floor(x), f = x - i, h = n => { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }, u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; }

/* ===== вспышка камеры ===== */
const Torch = {
  track: null, stream: null, supported: null, on: false, busy: false, want: false, level: 0, timer: 0,
  hasTorch(t) { try { return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch { return false; } },
  async init() {
    if (this.track) return true;
    if (isIOS || !navigator.mediaDevices?.getUserMedia) { this.supported = false; return false; }
    try {
      let s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      let t = s.getVideoTracks()[0];
      if (!this.hasTorch(t)) {
        // иногда вспышка привязана к другой задней камере — перебираем
        s.getTracks().forEach(x => x.stop()); t = null;
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        for (const d of devs.reverse()) {
          try {
            s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } } });
            const tt = s.getVideoTracks()[0];
            if (this.hasTorch(tt)) { t = tt; break; }
            s.getTracks().forEach(x => x.stop());
          } catch {}
        }
      }
      if (!t) { this.supported = false; return false; }
      this.stream = s; this.track = t; this.supported = true; this.on = false;
      return true;
    } catch (e) { this.supported = false; this.err = e.name; return false; }
  },
  async apply(v) {
    this.want = v;
    if (!this.track || this.busy || v === this.on) return;
    this.busy = true;
    try { await this.track.applyConstraints({ advanced: [{ torch: v }] }); this.on = v; } catch {}
    this.busy = false;
    if (this.track && this.want !== this.on) this.apply(this.want);
  },
  /* яркость 0..1: 100% — постоянный свет, между — быстрые мигания (ШИМ) */
  setLevel(l) { this.level = clamp(l); if (!this.timer && this.track) this.tick(); },
  tick() {
    const l = this.level, P = 140;
    if (l >= .97 || l <= .03) { this.apply(l > .5); this.timer = setTimeout(() => this.tick(), 30); return; }
    this.apply(true);
    setTimeout(() => { if (this.level < .97) this.apply(false); }, Math.max(30, P * l));
    this.timer = setTimeout(() => this.tick(), P);
  },
  release() {
    clearTimeout(this.timer); this.timer = 0; this.level = 0; this.want = false;
    if (this.track) { try { this.track.applyConstraints({ advanced: [{ torch: false }] }); } catch {} }
    this.stream?.getTracks().forEach(t => t.stop());
    this.track = null; this.stream = null; this.on = false;
  }
};

/* ===== не гасить экран ===== */
let wl = null;
async function wake(on) {
  try {
    if (on && !wl && 'wakeLock' in navigator) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); }
    else if (!on && wl) { wl.release(); wl = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && active) wake(true); });

/* ===== азбука Морзе ===== */
const MORSE = { A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..',
  '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',
  '.':'.-.-.-',',':'--..--','?':'..--..','!':'-.-.--','/':'-..-.','@':'.--.-.','-':'-....-',
  'А':'.-','Б':'-...','В':'.--','Г':'--.','Д':'-..','Е':'.','Ё':'.','Ж':'...-','З':'--..','И':'..','Й':'.---','К':'-.-','Л':'.-..','М':'--','Н':'-.','О':'---','П':'.--.','Р':'.-.','С':'...','Т':'-','У':'..-','Ф':'..-.','Х':'....','Ц':'-.-.','Ч':'---.','Ш':'----','Щ':'--.-','Ъ':'--.--','Ы':'-.--','Ь':'-..-','Э':'..-..','Ю':'..--','Я':'.-.-' };
const pretty = c => c.replace(/\./g, '·').replace(/-/g, '–');
/* элементы последовательности: [яркость, длительность в единицах, подпись] */
function codeItems(code, label = '') {
  const out = [];
  for (const ch of code) {
    if (ch === '.') out.push([1, 1, label], [0, 1, label]);
    else if (ch === '-') out.push([1, 3, label], [0, 1, label]);
    else out.push([0, 3, label]);
  }
  out.push([0, 6, label]);
  return out;
}
function morseItems(text) {
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    if (ch === ' ') { out.push([0, 4, ' ']); continue; }
    const c = MORSE[ch]; if (!c) continue;
    const lab = ch + '\n' + pretty(c);
    for (const s of c) out.push([1, s === '.' ? 1 : 3, lab], [0, 1, lab]);
    out.push([0, 2, lab]);
  }
  out.push([0, 5, '']);
  return out;
}
function seq(items, unit) {
  const total = items.reduce((a, b) => a + b[1], 0) || 1;
  return t => {
    let x = (t * 1000 / unit) % total;
    for (const it of items) { if (x < it[1]) return { l: it[0], label: it[2] }; x -= it[1]; }
    return { l: 0 };
  };
}
const U = 200; // единица Морзе, мс
const seqMode = (items, unit) => ({ init: st => st.f = seq(items, unit), f: (t, st) => st.f(t) });

/* ===== режимы ===== */
const MODES = [
  // Сигналы
  { id: 'sos', cat: 'Сигналы', ic: '🆘', name: 'SOS', desc: '··· ––– ··· — международный сигнал бедствия',
    init: st => st.f = seq(codeItems('...---...', 'SOS'), U), f: (t, st) => st.f(t) },
  { id: 'morse', cat: 'Сигналы', ic: '📡', name: 'Морзе', desc: 'Передать свой текст азбукой Морзе',
    param: { key: 'text', type: 'text', label: 'Текст (рус/англ/цифры)', def: 'ПРИВЕТ' },
    init: (st, p) => st.f = seq(morseItems(p.text), U), f: (t, st) => st.f(t) },
  { id: 'help', cat: 'Сигналы', ic: '🙏', name: 'ПОМОГИТЕ', desc: 'Слово «помогите» азбукой Морзе', ...seqMode(morseItems('ПОМОГИТЕ'), U) },
  { id: 'ok', cat: 'Сигналы', ic: '👌', name: 'OK', desc: '«Всё в порядке» — Морзе', ...seqMode(morseItems('OK'), U) },
  { id: 'here', cat: 'Сигналы', ic: '📍', name: 'Я здесь', desc: 'Двойной проблеск каждые 3 сек — чтобы вас нашли',
    ...seqMode([[1, 1], [0, 1.5], [1, 1], [0, 26.5]], 100) },
  { id: 'three', cat: 'Сигналы', ic: '⛰️', name: 'Три сигнала', desc: '3 вспышки — сигнал бедствия в горах',
    ...seqMode([[1, 5, '1'], [0, 5, '1'], [1, 5, '2'], [0, 5, '2'], [1, 5, '3'], [0, 30, '']], 100) },
  { id: 'beacon', cat: 'Сигналы', ic: '🗼', name: 'Маяк', desc: 'Одна вспышка раз в 5 секунд', ...seqMode([[1, 2], [0, 48]], 100) },
  { id: 'strobe', cat: 'Сигналы', ic: '⚡', name: 'Стробоскоп', desc: 'Частые вспышки',
    param: { key: 'hz', type: 'range', label: 'Частота', min: 1, max: 15, step: 1, def: 6, unit: ' Гц' },
    f: (t, st, p) => ({ l: (t * p.hz % 1) < .5 ? 1 : 0 }) },
  { id: 'bike', cat: 'Сигналы', ic: '🚲', name: 'Велофонарь', desc: 'Двойные вспышки — вас видно на дороге', ...seqMode([[1, .7], [0, .8], [1, .7], [0, 7.8]], 100) },
  { id: 'custom', cat: 'Сигналы', ic: '✍️', name: 'Свой паттерн', desc: 'Точка — коротко, тире — длинно, пробел — пауза',
    param: { key: 'pat', type: 'text', label: 'Паттерн, например: ..--  .-.', def: '.-.- --  ...' },
    init: (st, p) => st.f = seq(codeItems(p.pat || '.', pretty(p.pat || '.')), U), f: (t, st) => st.f(t) },

  // Эффекты
  { id: 'breath', cat: 'Эффекты', ic: '🌬️', name: 'Дыхание', desc: 'Плавный подъём яркости и затухание',
    param: { key: 'per', type: 'range', label: 'Длина вдоха-выдоха', min: 2, max: 12, step: 1, def: 4, unit: ' сек' },
    f: (t, st, p) => ({ l: (1 - Math.cos(t * 2 * Math.PI / p.per)) / 2 }) },
  { id: 'heart', cat: 'Эффекты', ic: '❤️', name: 'Пульс', desc: 'Тук-тук… как сердце',
    param: { key: 'bpm', type: 'range', label: 'Пульс', min: 40, max: 180, step: 5, def: 70, unit: ' уд/мин' },
    f: (t, st, p) => { const x = (t * p.bpm / 60) % 1; return { l: Math.max(Math.exp(-(((x - .06) / .04) ** 2)), .75 * Math.exp(-(((x - .28) / .05) ** 2))), c: '#ff2d55' }; } },
  { id: 'candle', cat: 'Эффекты', ic: '🕯️', name: 'Свеча', desc: 'Живое тёплое мерцание',
    f: t => ({ l: .45 + .55 * noise(t * 5) * (.6 + .4 * noise(t * 13 + 7)), c: '#ffb35c' }) },
  { id: 'fire', cat: 'Эффекты', ic: '🔥', name: 'Костёр', desc: 'Пляшущий огонь',
    f: t => { const n = noise(t * 8) * .6 + noise(t * 3.1 + 5) * .4; return { l: .3 + .7 * n, c: `hsl(${12 + n * 28},100%,${42 + n * 14}%)` }; } },
  { id: 'storm', cat: 'Эффекты', ic: '🌩️', name: 'Гроза', desc: 'Молнии в случайные моменты',
    f: (t, st) => {
      if (st.next == null) { st.next = t + .8; st.fl = []; }
      if (t >= st.next) {
        st.fl = []; let x = t; const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) { const d = .05 + Math.random() * .12; st.fl.push([x, x + d]); x += d + .06 + Math.random() * .15; }
        st.next = x + 1.5 + Math.random() * 5;
      }
      return { l: st.fl.some(([a, b]) => t >= a && t < b) ? 1 : 0, c: '#dfe7ff' };
    } },
  { id: 'police', cat: 'Эффекты', ic: '🚓', name: 'Мигалка', desc: 'Красный-синий, как у полиции',
    f: t => { const x = t % 1, y = x % .5; return { l: (y < .08 || (y > .14 && y < .22)) ? 1 : 0, c: x < .5 ? '#ff1a1a' : '#1a4dff' }; } },
  { id: 'amb', cat: 'Эффекты', ic: '🚨', name: 'Аварийка', desc: 'Оранжевый поворотник',
    f: t => ({ l: (t % 1) < .45 ? 1 : 0, c: '#ff9500' }) },
  { id: 'disco', cat: 'Эффекты', ic: '🪩', name: 'Дискотека', desc: 'Случайные цвета в ритм',
    param: { key: 'bpm', type: 'range', label: 'Темп', min: 60, max: 180, step: 5, def: 120, unit: ' BPM' },
    f: (t, st, p) => { const b = t * p.bpm / 60 * 2, i = Math.floor(b); if (st.i !== i) { st.i = i; st.h = Math.random() * 360; } return { l: (b % 1) < .6 ? 1 : 0, c: `hsl(${st.h},100%,55%)` }; } },
  { id: 'rainbow', cat: 'Эффекты', ic: '🌈', name: 'Радуга', desc: 'Плавная смена цветов экрана',
    f: t => ({ l: 1, c: `hsl(${(t * 40) % 360},100%,55%)` }) },
  { id: 'mic', cat: 'Эффекты', ic: '🎵', name: 'Цветомузыка', desc: 'Мигает в такт звуку (нужен микрофон)', noSpeed: true,
    param: { key: 'sens', type: 'range', label: 'Чувствительность', min: 1, max: 10, step: 1, def: 5, unit: '' },
    async init(st) {
      st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = st.ctx.createMediaStreamSource(st.stream);
      st.an = st.ctx.createAnalyser(); st.an.fftSize = 512; src.connect(st.an);
      st.buf = new Float32Array(st.an.fftSize); st.v = 0; st.peak = .05;
    },
    f: (t, st, p) => {
      st.an.getFloatTimeDomainData(st.buf);
      let s = 0; for (const x of st.buf) s += x * x;
      const rms = Math.sqrt(s / st.buf.length);
      st.peak = Math.max(rms, st.peak * .995, .01);
      const v = clamp((rms / st.peak) ** (11 - p.sens) * 1.1);
      st.v = v > st.v ? v : st.v * .85;
      return { l: st.v, c: `hsl(${(t * 30 + st.v * 120) % 360},100%,55%)` };
    },
    stop: st => { st.stream?.getTracks().forEach(t => t.stop()); st.ctx?.close(); } },

  // Полезное
  { id: 'sunrise', cat: 'Полезное', ic: '🌅', name: 'Рассвет', desc: 'Медленный подъём света — мягкое пробуждение', noSpeed: true,
    param: { key: 'min', type: 'range', label: 'Длительность', min: 1, max: 30, step: 1, def: 10, unit: ' мин' },
    f: (t, st, p, rt) => { const k = clamp(rt / (p.min * 60)); return { l: .02 + .98 * k * k, c: `hsl(${10 + k * 35},100%,${45 + k * 55}%)`, label: Math.round(k * 100) + '%' }; } },
  { id: 'sunset', cat: 'Полезное', ic: '🌇', name: 'Закат', desc: 'Плавное затухание и выключение — для сна', noSpeed: true,
    param: { key: 'min', type: 'range', label: 'Длительность', min: 1, max: 30, step: 1, def: 10, unit: ' мин' },
    f: (t, st, p, rt) => { const k = 1 - rt / (p.min * 60); if (k <= 0) return { l: 0, done: true }; return { l: k * k, c: `hsl(${15 + k * 25},100%,${40 + k * 25}%)` }; } },
  { id: 'night', cat: 'Полезное', ic: '🔴', name: 'Ночной красный', desc: 'Не сбивает ночное зрение', screenOnly: true, noSpeed: true,
    f: () => ({ l: 1, c: '#ff0000' }) },
  { id: 'ticker', cat: 'Полезное', ic: '🪧', name: 'Табло', desc: 'Бегущая строка огромными буквами', screenOnly: true, ticker: true,
    param: { key: 'text', type: 'text', label: 'Текст', def: 'ПРИВЕТ!' }, f: () => ({ l: 0 }) },
  { id: 'metro', cat: 'Полезное', ic: '🎼', name: 'Метроном', desc: 'Вспышка на каждый удар, акцент на первом', noSpeed: true,
    param: { key: 'bpm', type: 'range', label: 'Темп', min: 30, max: 240, step: 2, def: 100, unit: ' BPM' },
    f: (t, st, p) => { const b = t * p.bpm / 60, beat = Math.floor(b) % 4; return { l: (b % 1) < .12 ? 1 : 0, c: beat === 0 ? '#ff2d55' : '#ffffff', label: String(beat + 1) }; } },
];
const modeById = id => MODES.find(m => m.id === id);
function paramsOf(m) {
  const p = {}; if (m.param) p[m.param.key] = cfg.params[m.id]?.[m.param.key] ?? m.param.def;
  return p;
}

/* ===== общее состояние ===== */
let active = null;  // null | 'torch' | 'screen' | 'mode'
let locked = false, offAt = 0, cdTimer = 0;
const stage = $('#stage'), glow = $('#glow');

function startTimer(min) {
  clearInterval(cdTimer); offAt = min > 0 ? Date.now() + min * 60000 : 0;
  updateCountdown();
  if (offAt) cdTimer = setInterval(() => { if (Date.now() >= offAt) { stopAll(); toast('⏱ Выключено по таймеру'); } else updateCountdown(); }, 1000);
}
function updateCountdown() {
  let s = '';
  if (offAt) { const r = Math.max(0, Math.ceil((offAt - Date.now()) / 1000)); s = `⏱ ${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; }
  $('#stageCountdown').textContent = s; $('#torchCountdown').textContent = active === 'torch' ? s : '';
}

function stopAll() {
  Engine.stop();
  Torch.release();
  clearInterval(cdTimer); offAt = 0;
  stage.hidden = true; stage.classList.remove('locked', 'idle'); locked = false; $('#lockBtn').textContent = '🔓';
  glow.style.opacity = 0; $('#ticker').classList.remove('on');
  active = null; wake(false); navigator.vibrate?.(0);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  renderTorch(); updateCountdown();
}

/* ===== жесты: двойной тап, свайп для яркости ===== */
function gestures(el, o) {
  let y0 = null, v0 = 0, moved = false, lastUp = 0, tapT = 0, id = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || locked && el === stage) return;
    id = e.pointerId; y0 = e.clientY; moved = false; v0 = o.get?.() ?? 0;
  });
  el.addEventListener('pointermove', e => {
    if (y0 == null || e.pointerId !== id || !o.set) return;
    const dy = y0 - e.clientY;
    if (!moved && Math.abs(dy) > 12) { moved = true; clearTimeout(tapT); }
    if (moved) o.set(clamp(v0 + dy / (window.innerHeight * .55), .01, 1));
  });
  const up = e => {
    if (y0 == null || e.pointerId !== id) return;
    y0 = null;
    if (moved) { o.end?.(); return; }
    const now = Date.now();
    if (now - lastUp < 320) { clearTimeout(tapT); lastUp = 0; o.double?.(); }
    else { lastUp = now; tapT = setTimeout(() => o.tap?.(), 320); }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => y0 = null);
}

/* ===== вкладка «Вспышка» ===== */
function renderTorch() {
  const on = active === 'torch', l = cfg.torchLvl;
  $('#torchBtn').classList.toggle('on', on);
  $('#torchBtn').style.setProperty('--lv', l);
  $('#beam').style.opacity = on ? .25 + .75 * l : 0;
  $('#torchPct').textContent = Math.round(l * 100) + '%';
  $('#torchMeter').style.height = l * 100 + '%';
}
async function toggleTorch() {
  if (active === 'torch') { stopAll(); return; }
  stopAll();
  const ok = await Torch.init();
  if (!ok) { torchFail(); return; }
  active = 'torch'; Torch.setLevel(cfg.torchLvl); wake(true); startTimer(cfg.timer); renderTorch();
  if (cfg.torchLvl < .97) toast('Ниже 100% яркость регулируется быстрым миганием');
}
function torchFail() {
  updateTorchInfo();
  toast(isIOS ? '🍎 iPhone не разрешает сайтам включать вспышку. Используйте «Экран» 👉' : '⚠️ Вспышка недоступна: разрешите доступ к камере (нужен Chrome на Android)', 4000);
}
gestures($('#torchArea'), {
  get: () => cfg.torchLvl,
  set: v => { cfg.torchLvl = v; if (active === 'torch') Torch.setLevel(v); renderTorch(); },
  end: () => save('torchLvl'),
  double: toggleTorch
});
$('#torchBtn').addEventListener('click', toggleTorch);

/* ===== вкладка «Экран» ===== */
const COLORS = ['#ffffff', '#ffd9a0', '#dcecff', '#ff2a2a', '#2aff6a', '#3a6bff', '#ff4fd8'];
function renderScreen() {
  $('#orb').style.background = cfg.screenColor;
  $('#orb').style.opacity = .15 + .85 * cfg.screenLvl;
  $('#orb').style.boxShadow = `0 0 ${40 + 80 * cfg.screenLvl}px 10px ${cfg.screenColor}55`;
  $('#screenPct').textContent = Math.round(cfg.screenLvl * 100) + '%';
  document.querySelectorAll('#colors button').forEach(b => b.classList.toggle('sel', b.dataset.c === cfg.screenColor));
}
$('#colors').innerHTML = COLORS.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('');
$('#colors').addEventListener('click', e => { const c = e.target.dataset.c; if (c) { cfg.screenColor = c; save('screenColor'); renderScreen(); } });
function startScreen() {
  stopAll(); active = 'screen';
  showStage('Свет экрана');
  glow.classList.add('fade'); glow.style.background = cfg.screenColor;
  requestAnimationFrame(() => glow.style.opacity = cfg.screenLvl);
  setTimeout(() => glow.classList.remove('fade'), 500);
  wake(true); startTimer(cfg.timer);
  document.documentElement.requestFullscreen?.().catch(() => {});
}
gestures($('#screenArea'), {
  get: () => cfg.screenLvl,
  set: v => { cfg.screenLvl = v; renderScreen(); },
  end: () => save('screenLvl'),
  double: startScreen
});

/* ===== сцена (полный экран) ===== */
let idleT;
function showStage(title) {
  $('#stageTitle').textContent = title; $('#stageLabel').textContent = '';
  stage.hidden = false; poke();
}
function poke() { stage.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => stage.classList.add('idle'), 3000); }
let bubT;
function bubble(v) {
  $('#bubbleTxt').textContent = Math.round(v * 100) + '%'; $('#bubbleFill').style.height = v * 100 + '%';
  $('#bubble').classList.add('show'); clearTimeout(bubT); bubT = setTimeout(() => $('#bubble').classList.remove('show'), 900);
}
gestures(stage, {
  get: () => active === 'screen' ? cfg.screenLvl : cfg.master,
  set: v => {
    if (locked) return;
    if (active === 'screen') { cfg.screenLvl = v; glow.style.opacity = v; }
    else if (active === 'mode' && Engine.useScreen) cfg.master = v;
    else return;
    bubble(v);
  },
  end: () => { save('screenLvl'); save('master'); renderScreen(); },
  double: () => { if (!locked) stopAll(); },
  tap: poke
});
$('#stopBtn').addEventListener('click', stopAll);
let holdT;
$('#lockBtn').addEventListener('pointerdown', () => {
  if (!locked) { locked = true; stage.classList.add('locked'); $('#lockBtn').textContent = '🔒'; toast('🔒 Блокировка. Удерживайте замок 2 сек, чтобы снять'); return; }
  holdT = setTimeout(() => { locked = false; stage.classList.remove('locked'); $('#lockBtn').textContent = '🔓'; navigator.vibrate?.(60); toast('🔓 Разблокировано'); poke(); }, 2000);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('#lockBtn').addEventListener(ev, () => clearTimeout(holdT)));
stage.addEventListener('pointerdown', () => { if (locked) { stage.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => stage.classList.add('idle'), 2000); } });

/* ===== движок режимов ===== */
const Engine = {
  mode: null, st: {}, raf: 0, t0: 0, prev: 0, useScreen: true, useTorch: false, p: {},
  async start(m) {
    stopAll();
    this.p = paramsOf(m); this.st = {}; this.mode = m;
    this.useScreen = m.screenOnly || cfg.target !== 'torch';
    this.useTorch = !m.screenOnly && cfg.target !== 'screen';
    if (this.useTorch && !(await Torch.init())) {
      this.useTorch = false; this.useScreen = true; torchFail();
    }
    try { await m.init?.(this.st, this.p); }
    catch (e) { this.mode = null; toast('⚠️ Нет доступа: ' + (e.name === 'NotAllowedError' ? 'разрешите микрофон' : e.message)); return; }
    active = 'mode'; cfg.last = m.id; save('last'); renderLast();
    showStage(m.ic + ' ' + m.name);
    $('#stageHint').textContent = this.useScreen ? 'Двойной тап — выключить · свайп — яркость' : 'Светит вспышка · двойной тап — выключить';
    if (m.ticker) {
      const tx = (this.p.text || ' ').trim() || ' ';
      $('#tickerText').textContent = tx;
      $('#ticker').style.setProperty('--dur', Math.max(4, tx.length * 1.1) / (cfg.speeds[m.id] || 1) + 's');
      $('#ticker').classList.add('on');
    }
    glow.style.opacity = 0;
    this.speed = m.noSpeed ? 1 : (cfg.speeds[m.id] || 1);
    this.t0 = performance.now(); this.prev = 0;
    wake(true); startTimer(cfg.timer);
    const loop = () => {
      if (!this.mode) return;
      const rt = (performance.now() - this.t0) / 1000;
      const r = this.mode.f(rt * this.speed, this.st, this.p, rt) || {};
      const l = clamp(r.l ?? 0);
      if (this.useScreen && !m.ticker) { glow.style.background = r.c || cfg.screenColor; glow.style.opacity = l * cfg.master; }
      if (this.useTorch) Torch.setLevel(r.torch ?? l);
      if (cfg.vibrate && l > .5 && this.prev <= .5) navigator.vibrate?.(35);
      this.prev = l;
      if (r.label !== undefined && $('#stageLabel').textContent !== r.label) $('#stageLabel').textContent = r.label;
      if (r.done) { stopAll(); toast('🌙 Спокойной ночи'); return; }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },
  stop() {
    cancelAnimationFrame(this.raf);
    if (this.mode) { try { this.mode.stop?.(this.st); } catch {} }
    this.mode = null;
  }
};

/* ===== список режимов ===== */
function renderModes() {
  const card = m => `<button class="mode" data-id="${m.id}"><span class="st ${cfg.favs.includes(m.id) ? 'on' : ''}" data-fav="${m.id}">${cfg.favs.includes(m.id) ? '★' : '☆'}</span><span class="ic">${m.ic}</span><b>${m.name}</b><small>${m.desc}</small></button>`;
  let h = '';
  const favs = MODES.filter(m => cfg.favs.includes(m.id));
  if (favs.length) h += `<div class="cat">★ Избранное</div><div class="grid">${favs.map(card).join('')}</div>`;
  for (const c of ['Сигналы', 'Эффекты', 'Полезное']) h += `<div class="cat">${c}</div><div class="grid">${MODES.filter(m => m.cat === c).map(card).join('')}</div>`;
  $('#modeList').innerHTML = h;
}
function toggleFav(id) {
  const i = cfg.favs.indexOf(id); i < 0 ? cfg.favs.push(id) : cfg.favs.splice(i, 1);
  save('favs'); renderModes();
}
$('#modeList').addEventListener('click', e => {
  const f = e.target.closest('[data-fav]'); if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); return; }
  const b = e.target.closest('.mode'); if (b) openSheet(modeById(b.dataset.id));
});
function renderLast() {
  const m = modeById(cfg.last), b = $('#lastBtn');
  b.hidden = !m; if (m) b.textContent = `↻ Повторить: ${m.ic} ${m.name}`;
}
$('#lastBtn').addEventListener('click', () => { const m = modeById(cfg.last); if (m) Engine.start(m); });

/* ===== шторка режима ===== */
let sheetMode = null;
function seg(el, items, cur, onPick) {
  el.innerHTML = items.map(([v, t, dis]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'sel' : ''}" ${dis ? 'disabled' : ''}>${t}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return; el.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b)); onPick(b.dataset.v); };
}
const TIMERS = [[0, 'Нет'], [1, '1 мин'], [5, '5'], [15, '15'], [30, '30'], [60, '60']];
function openSheet(m) {
  sheetMode = m;
  $('#shIc').textContent = m.ic; $('#shName').textContent = m.name; $('#shDesc').textContent = m.desc;
  $('#shFav').textContent = cfg.favs.includes(m.id) ? '★' : '☆';
  const pw = $('#shParam'); pw.innerHTML = '';
  if (m.param) {
    const P = m.param, v = paramsOf(m)[P.key];
    if (P.type === 'text') {
      pw.innerHTML = `<label>${P.label}</label><input type="text" id="pIn" maxlength="80" value="${String(v).replace(/"/g, '&quot;')}">`;
    } else {
      pw.innerHTML = `<label>${P.label} <b id="pV">${v}${P.unit}</b></label><input type="range" id="pIn" min="${P.min}" max="${P.max}" step="${P.step}" value="${v}">`;
      $('#pIn').oninput = e => $('#pV').textContent = e.target.value + P.unit;
    }
  }
  $('#shSpeedWrap').hidden = !!m.noSpeed;
  const sp = cfg.speeds[m.id] || 1; $('#shSpeed').value = sp; $('#shSpeedV').textContent = sp + '×';
  $('#shTargetWrap').hidden = !!m.screenOnly;
  const noT = isIOS || Torch.supported === false;
  if (noT && cfg.target !== 'screen') cfg.target = 'screen';
  seg($('#shTarget'), [['torch', '🔦 Вспышка', noT], ['screen', '⬜ Экран'], ['both', '🔦+⬜ Оба', noT]], cfg.target, v => { cfg.target = v; save('target'); });
  seg($('#shTimer'), TIMERS, cfg.timer, v => { cfg.timer = +v; save('timer'); renderTimerSeg(); });
  $('#sheet').hidden = false;
}
$('#shSpeed').oninput = e => $('#shSpeedV').textContent = e.target.value + '×';
$('#shFav').onclick = () => { toggleFav(sheetMode.id); $('#shFav').textContent = cfg.favs.includes(sheetMode.id) ? '★' : '☆'; };
$('#shCancel').onclick = () => $('#sheet').hidden = true;
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });
$('#shStart').onclick = () => {
  const m = sheetMode;
  if (m.param) {
    let v = $('#pIn').value; if (m.param.type === 'range') v = +v;
    cfg.params[m.id] = { [m.param.key]: v }; save('params');
  }
  if (!m.noSpeed) { cfg.speeds[m.id] = +$('#shSpeed').value; save('speeds'); }
  $('#sheet').hidden = true;
  Engine.start(m);
};

/* ===== настройки ===== */
function renderTimerSeg() { seg($('#timerSeg'), TIMERS, cfg.timer, v => { cfg.timer = +v; save('timer'); }); }
if ('vibrate' in navigator) { $('#vibChk').checked = cfg.vibrate; $('#vibChk').onchange = e => { cfg.vibrate = e.target.checked; save('vibrate'); }; }
else { $('#vibCard').hidden = true; cfg.vibrate = false; }
function updateTorchInfo() {
  $('#torchInfo').textContent = isIOS
    ? 'На iPhone Apple запрещает сайтам управлять вспышкой. Все режимы работают через свет экрана.'
    : Torch.supported === false ? 'Вспышка недоступна. Проверьте разрешение камеры для сайта и используйте Chrome.'
    : Torch.supported ? '✅ Вспышка работает.' : 'Нажмите кнопку на вкладке «Вспышка», чтобы проверить (браузер спросит доступ к камере — это нужно для вспышки, снимков не делается).';
}
navigator.getBattery?.().then(b => {
  const upd = () => {
    const p = Math.round(b.level * 100);
    $('#batInfo').textContent = `${p}%${b.charging ? ' · заряжается ⚡' : ''}`;
    const low = p <= 20 && !b.charging;
    $('#batChip').hidden = !low; $('#batChip').textContent = `🔋 ${p}% — вспышка быстро разряжает`;
  };
  upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
}).catch(() => {});
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
$('#installState').textContent = standalone ? '✅ Приложение установлено.' : 'Сейчас открыто в браузере.';

/* ===== вкладки ===== */
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'more') updateTorchInfo();
}));
if (isIOS) {
  $('#torchHint').innerHTML = 'На iPhone вспышка сайтам недоступна —<br>используйте вкладку «Экран» и режимы';
  document.querySelector('nav button[data-tab="screen"]').click();
}

renderTorch(); renderScreen(); renderModes(); renderLast(); renderTimerSeg(); updateTorchInfo();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

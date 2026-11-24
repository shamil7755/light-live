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
  last: S.get('last', null), params: S.get('params', {}), speeds: S.get('speeds', {}), uses: S.get('uses', {})
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
const M_LAT = { A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..' };
const M_CYR = { 'А':'.-','Б':'-...','В':'.--','Г':'--.','Д':'-..','Е':'.','Ж':'...-','З':'--..','И':'..','Й':'.---','К':'-.-','Л':'.-..','М':'--','Н':'-.','О':'---','П':'.--.','Р':'.-.','С':'...','Т':'-','У':'..-','Ф':'..-.','Х':'....','Ц':'-.-.','Ч':'---.','Ш':'----','Щ':'--.-','Ъ':'--.--','Ы':'-.--','Ь':'-..-','Э':'..-..','Ю':'..--','Я':'.-.-' };
const M_NUM = { '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',
  '.':'.-.-.-',',':'--..--','?':'..--..','!':'-.-.--','/':'-..-.','@':'.--.-.','-':'-....-' };
const MORSE = { ...M_LAT, ...M_CYR, 'Ё': '.', ...M_NUM };
const invert = (...ms) => { const r = {}; for (const m of ms) for (const [k, v] of Object.entries(m)) if (!(v in r)) r[v] = k; return r; };
const DEC = { ru: invert(M_CYR, M_NUM), en: invert(M_LAT, M_NUM) };
const decodeCode = (c, lang) => DEC[lang][c] || (c ? '?' : '');
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
/* ===== генератор дополнительных режимов ===== */
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = a => '#' + a.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * k)); };
const smooth = x => (1 - Math.cos(x * Math.PI)) / 2;
/* плавно по кругу через список цветов */
const cycleColors = (cols, per) => t => { const x = (t / per) % cols.length, i = Math.floor(x); return mix(cols[i], cols[(i + 1) % cols.length], smooth(x - i)); };
const PALETTE = [['Белый', '#ffffff'], ['Тёплый белый', '#ffd9a0'], ['Холодный белый', '#dcecff'], ['Красный', '#ff1a1a'], ['Оранжевый', '#ff8a00'],
  ['Жёлтый', '#ffe600'], ['Лайм', '#a8ff00'], ['Зелёный', '#00ff4c'], ['Бирюзовый', '#00ffd0'], ['Голубой', '#00c8ff'], ['Синий', '#1a4dff'],
  ['Фиолетовый', '#8a2bff'], ['Пурпурный', '#ff00ff'], ['Розовый', '#ff5fa8'], ['Коралловый', '#ff6f50'], ['Мятный', '#7dffc0'],
  ['Лавандовый', '#b9a2ff'], ['Персиковый', '#ffb38a'], ['Золотой', '#ffc42a'], ['Небесный', '#87cfff']];
const dot = c => `<i class="cdot" style="background:${c}"></i>`;

// RGB и свой цвет
MODES.push(
  { id: 'rgb', cat: 'Цвета', ic: '🎨', name: 'RGB-перелив', desc: 'Красный → зелёный → синий по кругу',
    param: { key: 'per', type: 'range', label: 'Время на цвет', min: 1, max: 10, step: 1, def: 3, unit: ' сек' },
    f: (t, st, p) => ({ l: 1, c: cycleColors(['#ff0000', '#00ff00', '#0000ff'], p.per)(t) }) },
  { id: 'rgbstep', cat: 'Цвета', ic: '🟥', name: 'RGB-шаги', desc: 'Резкая смена R, G, B',
    param: { key: 'per', type: 'range', label: 'Смена каждые', min: .2, max: 3, step: .1, def: 1, unit: ' сек' },
    f: (t, st, p) => ({ l: 1, c: ['#ff0000', '#00ff00', '#0000ff'][Math.floor(t / p.per) % 3] }) },
  { id: 'mycolor', cat: 'Цвета', ic: '🖌️', name: 'Свой цвет', desc: 'Любой цвет из палитры', screenOnly: true, noSpeed: true,
    param: { key: 'c', type: 'color', label: 'Цвет', def: '#00e5ff' }, f: (t, st, p) => ({ l: 1, c: p.c }) },
  { id: 'mybreath', cat: 'Цвета', ic: '🫧', name: 'Свой цвет: дыхание', desc: 'Выбранный цвет плавно дышит',
    param: { key: 'c', type: 'color', label: 'Цвет', def: '#ff00aa' }, f: (t, st, p) => ({ l: smooth((t / 3) % 2 > 1 ? 2 - (t / 3) % 2 : (t / 3) % 2), c: p.c }) },
  { id: 'mystrobe', cat: 'Цвета', ic: '💥', name: 'Свой цвет: строб', desc: 'Стробоскоп выбранным цветом',
    param: { key: 'c', type: 'color', label: 'Цвет', def: '#00ff66' }, f: (t, st, p) => ({ l: (t * 6 % 1) < .5 ? 1 : 0, c: p.c }) },
);
// Цвета: постоянный свет
PALETTE.forEach(([n, c], i) => MODES.push({ id: 'sol' + i, cat: 'Цвета', ic: dot(c), name: n, desc: 'Ровный свет экрана', screenOnly: true, noSpeed: true, f: () => ({ l: 1, c }) }));
// Дыхание цветом
PALETTE.forEach(([n, c], i) => MODES.push({ id: 'br' + i, cat: 'Дыхание', ic: dot(c), name: 'Дыхание: ' + n.toLowerCase(), desc: 'Плавный подъём и затухание',
  f: t => ({ l: (1 - Math.cos(t * Math.PI / 2)) / 2, c }) }));
// Цветной стробоскоп
[['Белый', '#ffffff'], ['Красный', '#ff1a1a'], ['Синий', '#1a4dff'], ['Зелёный', '#00ff4c'], ['Жёлтый', '#ffe600'], ['Фиолетовый', '#8a2bff'],
 ['Голубой', '#00c8ff'], ['Розовый', '#ff5fa8'], ['Оранжевый', '#ff8a00'], ['Случайный', null]].forEach(([n, c], i) => MODES.push({
  id: 'stc' + i, cat: 'Стробоскопы', ic: c ? dot(c) : '🎲', name: 'Строб: ' + n.toLowerCase(), desc: 'Частые вспышки цветом',
  param: { key: 'hz', type: 'range', label: 'Частота', min: 1, max: 15, step: 1, def: 8, unit: ' Гц' },
  f: (t, st, p) => { const k = t * p.hz, j = Math.floor(k); if (!c && st.j !== j) { st.j = j; st.h = Math.random() * 360; } return { l: (k % 1) < .5 ? 1 : 0, c: c || `hsl(${st.h},100%,55%)` }; } }));
// Переливы двух-трёх цветов
[['Закат', ['#ff5e00', '#ff007b', '#7b2bff']], ['Океан', ['#0033ff', '#00c8ff', '#00ffb3']], ['Лес', ['#0b6b1f', '#5cff3a', '#c8ff70']],
 ['Лава', ['#ff1a00', '#ff8a00', '#ffcc00']], ['Северное сияние', ['#00ff9d', '#00b3ff', '#8a2bff', '#00ff9d']], ['Неон', ['#ff00ff', '#00ffff']],
 ['Сакура', ['#ffb7d5', '#ffffff', '#ff6fa8']], ['Лёд', ['#dcecff', '#87cfff', '#ffffff']], ['Токсик', ['#a8ff00', '#00ff4c', '#e6ff00']],
 ['Хэллоуин', ['#ff6a00', '#7b00ff']], ['Новый год', ['#ff1a1a', '#00c853', '#ffd700']], ['Космос', ['#1a0066', '#8a2bff', '#ff00aa', '#00c8ff']],
 ['Пустыня', ['#ffcc80', '#ff8a50', '#ffe0a0']], ['Глубина', ['#000a40', '#0044aa', '#00c8ff']], ['Конфета', ['#ff5fa8', '#7dffc0', '#b9a2ff']],
 ['Огонь и лёд', ['#ff3300', '#00c8ff']], ['Персик', ['#ffb38a', '#ff6f50']], ['Лаванда', ['#b9a2ff', '#e8dcff']], ['Солнце', ['#ffe600', '#ffffff', '#ff8a00']],
 ['Ночной город', ['#ff00aa', '#1a4dff', '#ff8a00']], ['Мята', ['#7dffc0', '#ffffff']], ['Флаг РФ', ['#ffffff', '#1a4dff', '#ff1a1a']],
 ['Вишня', ['#8b0020', '#ff1a4a']], ['Тропики', ['#00ffd0', '#ffe600', '#ff5fa8']], ['Галактика', ['#2b0066', '#ff00ff', '#00ffff', '#ffffff']]]
  .forEach(([n, cols], i) => MODES.push({ id: 'gr' + i, cat: 'Переливы', ic: dot(cols[0]), name: n, desc: 'Плавный перелив цветов',
    f: t => ({ l: 1, c: cycleColors(cols, 2.5)(t) }) }));
// Мигалки
[['Полиция: красный-белый', '#ff1a1a', '#ffffff'], ['Полиция: синий-белый', '#1a4dff', '#ffffff'], ['Пожарная', '#ff1a1a', '#ff1a1a'],
 ['Скорая: синяя', '#1a4dff', '#1a4dff'], ['Спецтехника: жёлтая', '#ffb300', '#ffb300'], ['Зелёный маячок', '#00ff4c', '#00ff4c'],
 ['США: красно-синяя', '#ff1a1a', '#1a4dff'], ['Фиолетовая мигалка', '#8a2bff', '#ff00ff']].forEach(([n, a, b], i) => MODES.push({
  id: 'sir' + i, cat: 'Мигалки', ic: '🚨', name: n, desc: 'Двойные вспышки поочерёдно',
  f: t => { const x = t % 1, y = x % .5; return { l: (y < .08 || (y > .14 && y < .22)) ? 1 : 0, c: x < .5 ? a : b }; } }));
MODES.push({ id: 'traffic', cat: 'Мигалки', ic: '🚦', name: 'Светофор', desc: 'Зелёный → жёлтый → красный', screenOnly: true,
  f: t => { const x = t % 12; return x < 5 ? { l: 1, c: '#00e04c', label: 'ИДИ' } : x < 6.5 ? { l: (x * 2 % 1) < .5 ? 1 : 0, c: '#00e04c' } : x < 8 ? { l: 1, c: '#ffcc00' } : { l: 1, c: '#ff1a1a', label: 'СТОЙ' }; } });
// Ритмы
const rhythm = (id, ic, name, desc, f) => MODES.push({ id, cat: 'Ритмы', ic, name, desc, f });
rhythm('dbl', '✌️', 'Двойная вспышка', 'Две вспышки и пауза', seq([[1, 1], [0, 1], [1, 1], [0, 7]], 100));
rhythm('tri', '🔱', 'Тройная вспышка', 'Три вспышки и пауза', seq([[1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 7]], 100));
rhythm('quad', '🍀', 'Четверная вспышка', 'Четыре вспышки и пауза', seq([[1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 8]], 100));
rhythm('slowblink', '🐢', 'Медленное мигание', 'Секунда свет, секунда темно', t => ({ l: (t % 2) < 1 ? 1 : 0 }));
rhythm('fastblink', '🐇', 'Быстрое мигание', '4 раза в секунду', t => ({ l: (t * 4 % 1) < .5 ? 1 : 0 }));
rhythm('saw', '📈', 'Нарастание', 'Плавно разгорается и резко гаснет', t => ({ l: t % 2 / 2 }));
rhythm('rsaw', '📉', 'Угасание', 'Резко вспыхивает и плавно гаснет', t => ({ l: 1 - t % 2 / 2 }));
rhythm('stairs', '🪜', 'Лесенка', 'Яркость ступеньками вверх', t => ({ l: (Math.floor(t * 2) % 5 + 1) / 5 }));
rhythm('wave', '🌊', 'Волна', 'Мягкие волны света', t => ({ l: .5 + .25 * Math.sin(t * 2) + .25 * Math.sin(t * 3.3) }));
rhythm('fireflies', '✨', 'Светлячки', 'Редкие мягкие огоньки', (t, st) => { if (st.n == null || t > st.n + 1.2) { st.n = t + .5 + Math.random() * 2.5; } const d = t - st.n; return { l: d > 0 && d < 1.2 ? Math.sin(d / 1.2 * Math.PI) : 0, c: '#d6ff5c' }; });
rhythm('flicker', '💡', 'Сломанная лампа', 'Случайные подмигивания', (t, st) => ({ l: noise(t * 20) > .25 || noise(t * 3) > .6 ? 1 : .05, c: '#fff4d6' }));
rhythm('glitch', '👾', 'Глитч', 'Цифровые сбои', (t, st) => { const k = Math.floor(t * 12); if (st.k !== k) { st.k = k; st.l = Math.random() < .3 ? 0 : 1; st.c = Math.random() < .2 ? `hsl(${Math.random() * 360},100%,55%)` : '#ffffff'; } return { l: st.l, c: st.c }; });
rhythm('heartfast', '💓', 'Пульс: бег', 'Учащённое сердцебиение', t => { const x = (t * 2.2) % 1; return { l: Math.max(Math.exp(-(((x - .06) / .05) ** 2)), .7 * Math.exp(-(((x - .3) / .06) ** 2))), c: '#ff2d55' }; });
rhythm('pingpong', '🏓', 'Пинг-понг', 'Тук… тук… быстрее и быстрее', t => { const x = t % 6, p = .9 - x * .13; return { l: (x % Math.max(p, .1)) < .06 ? 1 : 0 }; });
rhythm('lighthouse', '🗼', 'Маяк: вращение', 'Луч проходит по кругу', t => ({ l: Math.max(0, Math.cos(t * Math.PI / 2)) ** 8 }));
rhythm('lh2', '⚓', 'Маяк: группа', 'Две вспышки каждые 10 сек', seq([[1, 5], [0, 10], [1, 5], [0, 80]], 100));
rhythm('bounce', '🏀', 'Мячик', 'Подскоки затухают', t => { const x = t % 4; let y = 0, s = 0; for (let i = 0, d = 1; i < 5; i++, d *= .6) { if (x >= s && x < s + d) { y = Math.sin((x - s) / d * Math.PI) * d; break; } s += d; } return { l: y }; });
rhythm('morsebeat', '🥁', 'Барабан', 'Бум-бум-ча', seq([[1, 1], [0, 1], [1, 1], [0, 1], [.5, 2], [0, 2]], 120));
rhythm('dimbright', '🌗', 'Тень и свет', 'Переключение 30% ↔ 100%', t => ({ l: (t % 2) < 1 ? 1 : .3 }));
rhythm('sparkle', '🎇', 'Искры', 'Яркие короткие искры', (t, st) => { const k = Math.floor(t * 15); if (st.k !== k) { st.k = k; st.on = Math.random() < .25; } return { l: st.on ? 1 : 0, c: '#fff1b0' }; });
// Радуга-варианты
[['Радуга: быстрая', 1, 'f'], ['Радуга: медленная', 6, 'f'], ['Радуга: строб', 1.5, 's'], ['Радуга: дыхание', 3, 'b'], ['Радуга: пульс', 2, 'p']]
  .forEach(([n, per, kind], i) => MODES.push({ id: 'rb' + i, cat: 'Переливы', ic: '🌈', name: n, desc: 'Все цвета радуги',
    f: t => { const c = `hsl(${(t / per * 60) % 360},100%,55%)`; const l = kind === 's' ? ((t * 8 % 1) < .5 ? 1 : 0) : kind === 'b' ? (1 - Math.cos(t * Math.PI / 2)) / 2 : kind === 'p' ? Math.exp(-((((t % 1) - .1) / .08) ** 2)) : 1; return { l, c }; } }));
// Полезное свет
[['Свет для чтения', '#ffd9a0', .55, '📖'], ['Селфи-свет', '#fff3e6', 1, '🤳'], ['Мягкий свет для фото', '#ffe8cc', .8, '📸'],
 ['Свет для макияжа', '#fffaf2', 1, '💄'], ['Ночник', '#ff8a3a', .15, '🧸'], ['Кинотеатр (тусклый)', '#ff3a1a', .08, '🎬']]
  .forEach(([n, c, l, ic], i) => MODES.push({ id: 'use' + i, cat: 'Полезное', ic, name: n, desc: `Ровный свет ${Math.round(l * 100)}%`, screenOnly: true, noSpeed: true, f: () => ({ l, c }) }));
MODES.push({ id: 'countdown', cat: 'Полезное', ic: '⏳', name: 'Обратный отсчёт', desc: 'Цифры 10…1 и вспышка', screenOnly: true, noSpeed: true,
  f: (t, st, p, rt) => { const r = 10 - Math.floor(rt); if (rt > 11) return { l: 0, done: true }; return r > 0 ? { l: (rt % 1) < .15 ? .4 : 0, c: '#ffffff', label: String(r) } : { l: 1, c: '#ffffff', label: '🎉' }; } });
// Морзе-фразы
['SOS SOS', 'HELP', 'MAYDAY', 'ПОМОЩЬ', 'СПАСИТЕ', 'ОПАСНО', 'СТОП', 'ДА', 'НЕТ', 'ПРИВЕТ', 'ПОКА', 'СПАСИБО', 'ЛЮБЛЮ', 'ЛЮБЛЮ ТЕБЯ',
 'Я ЗДЕСЬ', 'ИДИ СЮДА', 'ЖДИ', 'ВСЁ ХОРОШО', 'НУЖЕН ВРАЧ', 'ВОДА', 'ЕДА', 'ОГОНЬ', 'БЕГИ', 'ТИХО', 'ДОМОЙ', 'СПОКОЙНОЙ НОЧИ',
 'С ДНЁМ РОЖДЕНИЯ', 'С НОВЫМ ГОДОМ', 'ХА ХА', 'HI', 'HELLO', 'YES', 'NO', 'LOVE', 'I LOVE YOU', 'THANKS', 'CQ CQ', '73', '88',
 'PARIS', 'QRZ', 'ABC', 'АБВ', '123', '0 1 2 3 4 5 6 7 8 9', 'АЛФАВИТ А Б В Г Д', 'ДРУГ', 'ВРАГ БЛИЗКО',
 'ДОБРОЕ УТРО', 'КАК ДЕЛА', 'Я ИДУ', 'ПОЗВОНИ', 'ОТБОЙ', 'GOOD NIGHT']
  .forEach((w, i) => MODES.push({ id: 'mp' + i, cat: 'Морзе-фразы', ic: '📡', name: w, desc: w.replace(/./g, ch => MORSE[ch] ? pretty(MORSE[ch]) + ' ' : ch === ' ' ? '/ ' : '').trim().slice(0, 60),
    ...seqMode(morseItems(w), U) }));

const modeById = id => MODES.find(m => m.id === id);
const CATS = ['Сигналы', 'Морзе-фразы', 'Эффекты', 'Цвета', 'Переливы', 'Дыхание', 'Стробоскопы', 'Мигалки', 'Ритмы', 'Полезное'];
const POPULAR = ['sos', 'morse', 'strobe', 'rgb', 'breath', 'police', 'candle', 'disco', 'here', 'mycolor', 'ticker', 'sunset'];
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
  const custom = !COLORS.includes(cfg.screenColor);
  $('#pick').classList.toggle('sel', custom); $('#pickIn').value = cfg.screenColor;
  if (custom) $('#pick').style.background = cfg.screenColor;
  hex2rgb(cfg.screenColor).forEach((v, i) => { const k = 'RGB'[i]; $('#r' + k).value = v; $('#v' + k).textContent = v; });
}
$('#colors').innerHTML = COLORS.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('')
  + `<label id="pick" class="pick" title="Любой цвет">🎨<input type="color" id="pickIn"></label>`;
$('#colors').addEventListener('click', e => { const c = e.target.dataset.c; if (c) { cfg.screenColor = c; save('screenColor'); renderScreen(); } });
const setColor = c => { cfg.screenColor = c; save('screenColor'); renderScreen(); if (active === 'screen') glow.style.background = c; };
$('#pickIn').addEventListener('input', e => setColor(e.target.value));
['R', 'G', 'B'].forEach(k => $('#r' + k).addEventListener('input', () => setColor(rgb2hex(['R', 'G', 'B'].map(x => +$('#r' + x).value)))));
$('#rgbBox').addEventListener('pointerdown', e => e.stopPropagation());
$('#colors').addEventListener('pointerdown', e => e.stopPropagation());
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
    active = 'mode'; cfg.last = m.id; save('last');
    cfg.uses[m.id] = (cfg.uses[m.id] || 0) + 1; save('uses'); renderLast(); renderModes();
    showStage(m.name);
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
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const openCats = new Set();
function renderModes() {
  const pinned = id => cfg.favs.includes(id);
  const card = m => `<button class="mode" data-id="${m.id}"><span class="st ${pinned(m.id) ? 'on' : ''}" data-fav="${m.id}">${pinned(m.id) ? '📌' : '📍'}</span><span class="ic">${m.ic}</span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></button>`;
  const q = ($('#modeSearch').value || '').trim().toLowerCase();
  let h = '';
  if (q) {
    const r = MODES.filter(m => (m.name + ' ' + m.desc + ' ' + m.cat).toLowerCase().includes(q));
    h = r.length ? `<div class="cat">Найдено: ${r.length}</div><div class="grid">${r.map(card).join('')}</div>` : `<p class="dim center">Ничего не найдено</p>`;
  } else {
    const pins = cfg.favs.map(modeById).filter(Boolean);
    const used = Object.entries(cfg.uses).sort((a, b) => b[1] - a[1]).map(([id]) => modeById(id)).filter(m => m && !pinned(m.id)).slice(0, 8);
    const main = [...pins, ...used];
    for (const id of POPULAR) { if (main.length >= 12) break; const m = modeById(id); if (m && !main.includes(m)) main.push(m); }
    if (pins.length) h += `<div class="cat">📌 Закреплённые</div><div class="grid">${pins.map(card).join('')}</div>`;
    const rest = main.slice(pins.length);
    h += `<div class="cat">⭐ Основные${used.length ? ' · часто используемые' : ''}</div><div class="grid">${rest.map(card).join('')}</div>`;
    h += `<div class="cat">📂 Все режимы · ${MODES.length}</div>`;
    for (const c of CATS) {
      const ms = MODES.filter(m => m.cat === c);
      h += `<details class="fold" data-cat="${c}" ${openCats.has(c) ? 'open' : ''}><summary>${c}<span>${ms.length}</span></summary><div class="grid">${ms.map(card).join('')}</div></details>`;
    }
  }
  $('#modeList').innerHTML = h;
  $('#modeList').querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => d.open ? openCats.add(d.dataset.cat) : openCats.delete(d.dataset.cat)));
}
$('#modeSearch').addEventListener('input', renderModes);
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
  b.hidden = !m; if (m) b.innerHTML = `↻ Повторить: ${m.ic} ${esc(m.name)}`;
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
  $('#shIc').innerHTML = m.ic; $('#shName').textContent = m.name; $('#shDesc').textContent = m.desc;
  $('#shFav').textContent = cfg.favs.includes(m.id) ? '📌' : '📍';
  const pw = $('#shParam'); pw.innerHTML = '';
  if (m.param) {
    const P = m.param, v = paramsOf(m)[P.key];
    if (P.type === 'color') {
      pw.innerHTML = `<label>${P.label}</label><div class="colorrow"><input type="color" id="pIn" value="${v}"><span>Нажмите на квадрат — откроется палитра</span></div>`;
    } else if (P.type === 'text') {
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
$('#shFav').onclick = () => { toggleFav(sheetMode.id); $('#shFav').textContent = cfg.favs.includes(sheetMode.id) ? '📌' : '📍'; toast(cfg.favs.includes(sheetMode.id) ? '📌 Закреплено сверху' : 'Откреплено'); };
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

/* ===== Морзе: язык, подвкладки ===== */
let mLang = S.get('mLang', 'ru');
seg($('#mLang'), [['ru', 'RU'], ['en', 'EN']], mLang, v => { mLang = v; S.set('mLang', v); renderDec(); renderAbc(); Rx.render(); });
seg($('#mSub'), [['rx', '📷 Приёмник'], ['dec', '⌨️ Декодер'], ['abc', '🔤 Азбука']], 'rx', v => {
  ['rx', 'dec', 'abc'].forEach(k => $('#m-' + k).hidden = k !== v);
  if (v !== 'rx') Rx.stop();
});

/* --- декодер: я пишу, что увидел --- */
function decodeText(src, lang) {
  return src.trim().split(/\s*[\/|]\s*|\s{3,}/).map(w => w.trim().split(/\s+/).map(c => decodeCode(c.replace(/·/g, '.').replace(/[–—_]/g, '-'), lang)).join('')).join(' ');
}
function renderDec() {
  const v = $('#decIn').value;
  $('#decOut').textContent = v.trim() ? decodeText(v, mLang) : 'Здесь появится текст';
  $('#decAlt').textContent = v.trim() ? (mLang === 'ru' ? 'Если латиница: ' : 'Если кириллица: ') + decodeText(v, mLang === 'ru' ? 'en' : 'ru') : '';
}
$('#decIn').addEventListener('input', renderDec);
$('.keys').addEventListener('click', e => {
  const k = e.target.closest('button')?.dataset.k; if (k == null) return;
  const inp = $('#decIn');
  if (k === 'back') inp.value = inp.value.replace(/( \/ |.)$/, '');
  else if (k === 'clr') inp.value = '';
  else inp.value += k;
  navigator.vibrate?.(k === '.' ? 20 : k === '-' ? 60 : 10);
  renderDec();
});

/* --- азбука --- */
function renderAbc() {
  const tab = mLang === 'ru' ? M_CYR : M_LAT;
  const cell = ([ch, c]) => `<button class="abcell" data-c="${c}"><b>${ch}</b><span>${pretty(c)}</span></button>`;
  $('#abcGrid').innerHTML = Object.entries(tab).map(cell).join('') + Object.entries(M_NUM).map(cell).join('');
}
$('#abcGrid').addEventListener('click', e => {
  const b = e.target.closest('.abcell'); if (!b || b.dataset.busy) return;
  const code = b.dataset.c, u = 150, vib = []; let t = 0; b.dataset.busy = 1;
  for (const s of code) {
    const d = s === '.' ? u : 3 * u; vib.push(d, u);
    setTimeout(() => b.classList.add('lit'), t); setTimeout(() => b.classList.remove('lit'), t + d); t += d + u;
  }
  setTimeout(() => delete b.dataset.busy, t);
  navigator.vibrate?.(vib);
});

/* --- приёмник: распознаёт вспышки камерой --- */
const Rx = {
  stream: null, raf: 0, cv: document.createElement('canvas'), lo: 255, hi: 0, on: false, tEdge: 0, unit: 0, cur: '', text: '', flushed: true, spaced: true,
  async start() {
    if (this.stream) return;
    if (active === 'torch' || (active === 'mode' && Engine.useTorch)) stopAll(); // камеру занимает вспышка
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
    } catch (e) { toast('⚠️ Нет доступа к камере — разрешите его в настройках браузера'); return; }
    const v = $('#rxVideo'); v.srcObject = this.stream; await v.play().catch(() => {});
    $('#rxStart').hidden = true; wake(true);
    this.cv.width = 64; this.cv.height = 48; this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.lo = 255; this.hi = 0; this.on = false; this.tEdge = performance.now(); this.unit = 0;
    this.loop();
  },
  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    $('#rxVideo').srcObject = null; $('#rxStart').hidden = false; $('#rxLamp').classList.remove('on');
    if (!active) wake(false);
  },
  loop() {
    const v = $('#rxVideo');
    if (!this.stream) return;
    if (v.readyState >= 2) {
      this.ctx.drawImage(v, 0, 0, 64, 48);
      const d = this.ctx.getImageData(20, 14, 24, 20).data; // центр кадра — рамка-прицел
      let mx = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4) { const y = .3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2]; sum += y; if (y > mx) mx = y; }
      const val = .6 * mx + .4 * sum / (d.length / 4);
      // медленно подстраиваем «темно» и «светло»
      this.lo = val < this.lo ? val : this.lo + (val - this.lo) * .004;
      this.hi = val > this.hi ? val : this.hi + (val - this.hi) * .004;
      const range = this.hi - this.lo, ok = range > 22;
      const thrOn = this.lo + range * .6, thrOff = this.lo + range * .4;
      const now = performance.now();
      const st = ok && (this.on ? val > thrOff : val > thrOn);
      if (st !== this.on) {
        const dur = now - this.tEdge;
        if (this.on) this.mark(dur);
        this.on = st; this.tEdge = now;
      } else if (!this.on && this.unit) {
        const gap = now - this.tEdge;
        if (!this.flushed && gap > this.unit * 2.5) this.flush();
        if (!this.spaced && gap > this.unit * 6) { this.text += ' '; this.spaced = true; this.render(); }
      }
      $('#rxLevel').style.width = clamp(val / 255) * 100 + '%';
      $('#rxThr').style.left = clamp(thrOn / 255) * 100 + '%';
      $('#rxLamp').classList.toggle('on', st);
      $('#rxAim').classList.toggle('weak', !ok);
    }
    this.raf = requestAnimationFrame(() => this.loop());
  },
  mark(d) {
    if (d < 35) return; // шум
    if (!this.unit || d < this.unit * .5) this.unit = d;
    const sym = d < this.unit * 2 ? '.' : '-';
    if (sym === '.') this.unit = this.unit * .7 + d * .3;
    this.cur += sym; this.flushed = false; this.spaced = false;
    navigator.vibrate?.(sym === '.' ? 15 : 45);
    this.render();
  },
  flush() { this.text += decodeCode(this.cur, mLang); this.cur = ''; this.flushed = true; this.render(); },
  render() {
    $('#rxCur').textContent = this.cur ? pretty(this.cur) + '  → ' + decodeCode(this.cur, mLang) : (this.unit ? `точка ≈ ${Math.round(this.unit)} мс` : ' ');
    $('#rxText').textContent = this.text || 'Распознанный текст появится здесь';
  }
};
$('#rxStart').onclick = () => Rx.start();
$('#rxStop').onclick = () => Rx.stop();
$('#rxClear').onclick = () => { Rx.text = ''; Rx.cur = ''; Rx.unit = 0; Rx.render(); };
renderDec(); renderAbc(); Rx.render();

/* ===== вкладки ===== */
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'more') updateTorchInfo();
  if (b.dataset.tab !== 'morse') Rx.stop();
}));
if (isIOS) {
  $('#torchHint').innerHTML = 'На iPhone вспышка сайтам недоступна —<br>используйте вкладку «Экран» и режимы';
  document.querySelector('nav button[data-tab="screen"]').click();
}

renderTorch(); renderScreen(); renderModes(); renderLast(); renderTimerSeg(); updateTorchInfo();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

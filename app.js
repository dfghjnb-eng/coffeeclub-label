/* ══════════════════════════════════════════════════════════════
   커피클럽 라벨 프린터 — 웹 버전 (Rongta RP420 / WebUSB)
   데스크톱 PyQt 앱(printer_app.py + label_printer.py)의 웹 이식
   ══════════════════════════════════════════════════════════════ */

// ─────────── 설정 ───────────
const PUBLIC_BASE_URL = 'https://coffeeclub-public.vercel.app';
const STORE_QR_URL    = 'https://smartstore.naver.com/coffeegisul';

const SUPABASE_URL  = 'https://qbsiveekbogmfaqnrbmz.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFic2l2ZWVrYm9nbWZhcW5yYm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDQ4NjgsImV4cCI6MjA5MjU4MDg2OH0.' +
  'xlXLPogp6ur0HXxZogpKyZTz7adItL-Eh2vNbDz-tqY';

// 프린터 (203 DPI)
const USB_VENDOR  = 0x0FE6;
const USB_PRODUCT = 0x811E;
const W_FULL  = 600;      // 헤드 전체 폭 (dots)
const LABEL_X = 130;      // 라벨 좌측 오프셋
const LW = 240, LH = 120; // 라벨 30mm × 15mm
const GAP_MM = 3.0;

const LS_SETTINGS = 'coffeeclub.printer.settings';
const LS_PRESETS  = 'coffeeclub.printer.presets';
const LS_CALIB    = 'coffeeclub.printer.calibrated';

const FONTS = {
  '서울한강 Light':          'HangangL',
  '서울한강 Regular':        'HangangM',
  '서울한강 Bold':           'HangangB',
  '서울한강 ExtraBold':      'HangangEB',
  '서울한강 장체 Light':      'HangangJL',
  '서울한강 장체 Medium':     'HangangJM',
  '서울한강 장체 Bold':       'HangangJB',
  '서울한강 장체 ExtraBold':  'HangangJEB',
  '서울남산 Light':          'NamsanL',
  '서울남산 Regular':        'NamsanM',
  '서울남산 Bold':           'NamsanB',
  '서울남산 ExtraBold':      'NamsanEB',
  '서울남산 장체 Light':      'NamsanJL',
  '서울남산 장체 Medium':     'NamsanJM',
  '서울남산 장체 Bold':       'NamsanJB',
  '서울남산 장체 ExtraBold':  'NamsanJEB',
  'BM 도현':                'Dohyeon',
  '한글누리 Regular':        'NuriR',
  '한글누리 Bold':           'NuriB',
  '시스템 고딕':             'Apple SD Gothic Neo',
};

const ORDER_LABELS = {
  roasting_coffee: '☕ 로스팅 + 커피명',
  date:            '📅 날짜',
  note:            '✍️ 맛노트',
  custom:          '📝 추가텍스트',
};
const DEFAULT_ORDER = ['roasting_coffee', 'date', 'note', 'custom'];

// ─────────── 상태 ───────────
const state = {
  coffees: [],
  current: null,
  qrType: 0,
  mode: 'usb',        // 'server' = 매장 인쇄 서버 경유 / 'usb' = 이 컴퓨터에 직접 연결
  aligned: false,     // 종이가 라벨 시작점에 맞춰져 있는지 (배출하면 깨짐)
  preset: null,       // 지금 수정 중인 프리셋 이름 (저장하면 여기에 덮어쓴다)
  device: null,
  iface: 0,
  endpoint: 1,
  order: DEFAULT_ORDER.slice(),
  checked: new Set(DEFAULT_ORDER),
};

const $ = (id) => document.getElementById(id);
const store = {
  get(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

/**
 * 프리셋·설정 저장소
 *
 * 매장 서버에 연결돼 있으면 맥의 파일을 그대로 쓴다.
 * → 데스크톱 앱에서 저장한 프리셋·설정이 폰에서도 그대로 보이고, 반대도 마찬가지.
 * 서버가 없으면(GitHub Pages 등) 브라우저 저장소를 쓴다.
 */
const remote = {
  async load(kind) {                       // kind: 'presets' | 'settings'
    if (state.mode === 'server') {
      try {
        const info = await (await fetch('api/' + kind)).json();
        if (info.ok) return info[kind] || {};
      } catch {}
    }
    return store.get(kind === 'presets' ? LS_PRESETS : LS_SETTINGS, {}) || {};
  },
  async save(kind, data) {
    if (state.mode === 'server') {
      try {
        await fetch('api/' + kind, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [kind]: data }),
        });
        return;
      } catch {}
    }
    store.set(kind === 'presets' ? LS_PRESETS : LS_SETTINGS, data);
  },
};

// ─────────── 스핀박스 위젯 ───────────
function makeStep(parent, key, label, val, min, max, step, decimals) {
  const wrap = document.createElement('div');
  wrap.className = 'step';
  wrap.innerHTML =
    `<label>${label}</label>` +
    `<input type="text" id="${key}" inputmode="decimal">` +
    `<span class="arrows"><button type="button" data-d="1">▲</button>` +
    `<button type="button" data-d="-1">▼</button></span>`;
  parent.appendChild(wrap);

  const input = wrap.querySelector('input');
  const fmt = (v) => decimals ? v.toFixed(decimals) : String(Math.round(v));
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const setV = (v) => { input.value = fmt(clamp(+(v.toFixed(3)))); };
  setV(val);

  wrap.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { setV(getStep(key) + step * (+b.dataset.d)); render(); };
  });
  input.onchange = () => {
    const v = parseFloat(input.value.replace(',', '.'));
    setV(Number.isFinite(v) ? v : val);
    render();
  };
  input.oninput = () => { if (Number.isFinite(parseFloat(input.value))) render(); };
  return input;
}
const getStep = (key) => {
  const v = parseFloat($(key).value);
  return Number.isFinite(v) ? v : 0;
};
const setStep = (key, v) => {
  const el = $(key);
  if (!el) return;
  const dec = el.value.includes('.') || String(v).includes('.') ? 1 : 0;
  el.value = (key === 'fsNum' || key === 'fsMain' || key === 'fsSub' ||
              key === 'fsTiny' || key === 'fsCustom') ? Number(v).toFixed(1) : String(Math.round(v));
};

// ─────────── 라벨 그리기 (label_printer.py 이식) ───────────
function textW(ctx, text, ls) {
  if (!text) return 0;
  return ctx.measureText(text).width + ls * Math.max(0, [...text].length - 1);
}

function drawText(ctx, x, y, text, ls) {
  const m = ctx.measureText('가');
  const ascent = Number.isFinite(m.fontBoundingBoxAscent)
    ? m.fontBoundingBoxAscent : m.actualBoundingBoxAscent || 0;
  const baseY = y + ascent;
  if (ls === 0) { ctx.fillText(text, x, baseY); return; }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, baseY);
    cx += ctx.measureText(ch).width + ls;
  }
}

function wrapText(ctx, text, maxW, ls) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const ch of para) {
      if (textW(ctx, cur + ch, ls) <= maxW) cur += ch;
      else { if (cur) out.push(cur); cur = ch; }
    }
    out.push(cur);
  }
  return out.length ? out : [''];
}

/** 240×120 라벨을 흰 배경·검정 글씨로 그린다 */
function renderLabel(ctx, o) {
  const ls = o.ls | 0, lg = o.lg | 0;
  const family = o.family;
  const setFont = (px) => { ctx.font = `${px}px "${family}", sans-serif`; };

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, LW, LH);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  const M = 8, QR_SIZE = 82;
  let qrX, textMaxW;
  if (o.showQR) { qrX = LW - QR_SIZE - 6; textMaxW = qrX - 8; }
  else          { qrX = LW;               textMaxW = LW - 8; }
  const MAX_Y = LH - 2;

  // ── QR 코드 ──
  if (o.showQR) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(o.qrData || PUBLIC_BASE_URL);
      qr.make();
      const n = qr.getModuleCount(), box = 3, border = 1;
      const side = (n + border * 2) * box;
      const off = document.createElement('canvas');
      off.width = off.height = side;
      const oc = off.getContext('2d');
      oc.fillStyle = '#fff'; oc.fillRect(0, 0, side, side);
      oc.fillStyle = '#000';
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          if (qr.isDark(r, c))
            oc.fillRect((c + border) * box, (r + border) * box, box, box);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, qrX, M, QR_SIZE, QR_SIZE);
    } catch (e) { /* QR 실패 시 건너뜀 */ }

    // ── QR 아래: 자세히 보기 ▲ ──
    if (o.showDetails) {
      setFont(o.fsTiny);
      const label = '자세히 보기';
      const areaY = M + QR_SIZE + 4;
      const tw = 10, th = 6, gapTri = 3;
      const txtW = Math.round(textW(ctx, label, ls));
      const startX = qrX + Math.floor((QR_SIZE - (txtW + gapTri + tw)) / 2);
      drawText(ctx, startX, areaY - 1, label, ls);
      const tx2 = startX + txtW + gapTri;
      ctx.beginPath();
      ctx.moveTo(tx2, areaY + th);
      ctx.lineTo(tx2 + tw, areaY + th);
      ctx.lineTo(tx2 + tw / 2, areaY);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── 텍스트 영역 ──
  const tx = 4;
  let y = M + 2;

  const drawWrapped = (text, size, gap) => {
    if (!text) return;
    setFont(size);
    for (const line of wrapText(ctx, text, textMaxW, ls)) {
      if (y + size > MAX_Y) break;
      drawText(ctx, tx, y, line, ls);
      y += size + gap + lg;
    }
  };

  const parts = {
    roasting_coffee() {
      const roasting = o.roasting || '', coffee = o.coffee || '', sep = '  ';
      if (o.showRoasting && o.showCoffee) {
        setFont(o.fsNum);
        const rw = textW(ctx, roasting + sep, ls);
        setFont(o.fsMain);
        const lines = wrapText(ctx, coffee, textMaxW - rw, ls);
        const lineH = Math.max(o.fsNum, o.fsMain);
        setFont(o.fsNum);
        drawText(ctx, tx, y, roasting + sep, ls);
        setFont(o.fsMain);
        drawText(ctx, tx + rw, y + Math.max(0, o.fsNum - o.fsMain), lines[0], ls);
        y += lineH + 4 + lg;
        for (const line of lines.slice(1)) {
          if (y + o.fsMain > MAX_Y) break;
          drawText(ctx, tx, y, line, ls);
          y += o.fsMain + 4 + lg;
        }
      } else if (o.showRoasting) {
        setFont(o.fsNum);
        drawText(ctx, tx, y, roasting, ls);
        y += o.fsNum + 4 + lg;
      } else if (o.showCoffee) {
        drawWrapped(coffee, o.fsMain, 4);
      }
    },
    date() {
      if (o.showDate && o.date) drawWrapped(o.date, o.fsSub, 4);
    },
    note() {
      if (o.showNote) drawWrapped(o.note, o.fsSub, 2);
    },
    custom() {
      const t = (o.customText || '').trim();
      if (o.showCustom && t) drawWrapped(t, o.fsCustom, 2);
    },
  };

  for (const key of o.order) parts[key] && parts[key]();
}

// ─────────── 주문(라벨) 데이터 만들기 ───────────
function buildOrder() {
  const d = state.current || {};
  const showDate = $('dateCheck').checked;
  return {
    roasting: $('roasting').value.trim() || '—',
    coffee:   d.name || '',
    note:     d.flavor_notes || '',
    date:     showDate ? $('dateInput').value.trim() : '',
    customText: $('customText').value,
    qrData:   qrURL(),
    family:   FONTS[$('fontSelect').value] || 'HangangM',
    fsNum:    getStep('fsNum'),
    fsMain:   getStep('fsMain'),
    fsSub:    getStep('fsSub'),
    fsTiny:   getStep('fsTiny'),
    fsCustom: getStep('fsCustom'),
    ls:       getStep('lsSpin'),
    lg:       getStep('lgSpin'),
    order:    state.order.slice(),
    showRoasting: state.checked.has('roasting_coffee'),
    showCoffee:   state.checked.has('roasting_coffee'),
    showDate:     state.checked.has('date'),
    showNote:     state.checked.has('note'),
    showCustom:   state.checked.has('custom'),
    showQR:       $('visQR').checked,
    showDetails:  $('visDetails').checked,
  };
}

function qrURL() {
  if (state.qrType === 1) return STORE_QR_URL;
  if (state.qrType === 2) return $('qrCustom').value.trim() || PUBLIC_BASE_URL;
  const id = state.current?.id || '';
  return `${PUBLIC_BASE_URL}/coffee/${id}`;
}

// ─────────── 미리보기 ───────────
let renderPending = false;
function render() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    const o = buildOrder();
    const off = document.createElement('canvas');
    off.width = LW; off.height = LH;
    renderLabel(off.getContext('2d'), o);

    const cv = $('previewCanvas');
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
  });
}

// ─────────── 라벨 → 1비트 비트맵 ───────────
function labelToBitmap(o) {
  const gapPx  = Math.round(GAP_MM * 203 / 25.4);   // 24
  const height = LH + gapPx;

  const cv = document.createElement('canvas');
  cv.width = W_FULL; cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W_FULL, height);

  const off = document.createElement('canvas');
  off.width = LW; off.height = LH;
  renderLabel(off.getContext('2d'), o);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, LABEL_X, 0);

  const px = ctx.getImageData(0, 0, W_FULL, height).data;
  const bytesPerRow = W_FULL / 8;
  const data = new Uint8Array(bytesPerRow * height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < W_FULL; x += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const p = (y * W_FULL + x + b) * 4;
        const lum = (px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000;
        if (lum < 128) byte |= (0x80 >> b);   // 어두우면 인쇄 비트 = 1
      }
      data[i++] = byte;
    }
  }
  return { data, height, bytesPerRow };
}

const labelToRaster = (o) => {
  const b = labelToBitmap(o);
  return rasterCommand(b.bytesPerRow, b.height, b.data);
};

function toBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

function rasterCommand(bytesPerRow, height, data) {
  const head = new Uint8Array(10);
  head.set([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00], 0);
  head[6] = bytesPerRow & 0xff;  head[7] = (bytesPerRow >> 8) & 0xff;
  head[8] = height & 0xff;       head[9] = (height >> 8) & 0xff;
  const out = new Uint8Array(head.length + data.length);
  out.set(head, 0);
  out.set(data, head.length);
  return out;
}

function ejectCommand() {
  const gapPx = Math.round(GAP_MM * 203 / 25.4);
  const rows  = Math.max(1, LH + gapPx - 32);
  const bytesPerRow = W_FULL / 8;
  return rasterCommand(bytesPerRow, rows, new Uint8Array(bytesPerRow * rows));
}

const calibrateCommand = () =>
  new TextEncoder().encode('SIZE 30 mm,15 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nPRINT 1\r\n');

/**
 * 인쇄 전 라벨 위치 자동 정렬 — 갭센서 캘리브 (빈 라벨 1장 소비).
 * 이 프린터는 래스터 인쇄 때 갭 센서를 쓰지 않아 위치가 어긋나고,
 * HOME·FORMFEED·BACKFEED·SET TEAR ON 은 듣지 않았다.
 * ★ 핵심은 ALIGN_WAIT — 2000ms 로는 어긋나고 2500ms 에서 맞는다.
 */
const ALIGN_WAIT = 2500;
const alignJobs = () => [calibrateCommand()];

// ─────────── WebUSB ───────────
function usbSupported() { return 'usb' in navigator; }

async function connectPrinter() {
  if (!usbSupported()) {
    setStatus('이 브라우저는 WebUSB를 지원하지 않아요. Chrome 또는 Edge에서 열어주세요.');
    return;
  }
  try {
    const dev = await navigator.usb.requestDevice({
      filters: [{ vendorId: USB_VENDOR, productId: USB_PRODUCT }],
    });
    await openDevice(dev);
    setStatus('✓ 프린터 연결됨');
  } catch (e) {
    if (e?.name !== 'NotFoundError') setStatus('연결 실패: ' + e.message);
  }
}

/** 열지 않고도 알 수 있는 정보로 출력 엔드포인트를 찾는다 */
function findEndpoint(dev) {
  const cfg = dev.configuration || (dev.configurations && dev.configurations[0]);
  for (const iface of (cfg?.interfaces || [])) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === 'out');
      if (out) return { iface: iface.interfaceNumber, endpoint: out.endpointNumber };
    }
  }
  return { iface: 0, endpoint: 1 };
}

/**
 * 장치를 기억만 해둔다 — 프린터를 붙잡지(claim) 않는다.
 * 붙잡은 채로 두면 매장 앱·인쇄 서버가 프린터를 못 쓰게 되므로,
 * 실제 점유는 인쇄하는 순간에만 한다.
 */
async function openDevice(dev) {
  const { iface, endpoint } = findEndpoint(dev);
  state.device = dev;
  state.iface = iface;
  state.endpoint = endpoint;
  markConnected(true);
}

async function tryReconnect() {
  if (!usbSupported()) return;
  const list = await navigator.usb.getDevices();
  const dev = list.find((d) => d.vendorId === USB_VENDOR && d.productId === USB_PRODUCT);
  if (dev) { try { await openDevice(dev); } catch {} }
}

/**
 * 인쇄할 때만 열고·붙잡고, 끝나면 즉시 놓아준다.
 * jobs 안의 명령들은 한 번의 점유로 이어서 보낸다(연속 인쇄).
 */
async function sendUSBJobs(jobs) {
  const dev = state.device;
  if (!dev) throw new Error('프린터가 연결되지 않았어요. [프린터 연결]을 먼저 눌러주세요.');

  if (!dev.opened) await dev.open();
  if (!dev.configuration) await dev.selectConfiguration(1);
  try {
    await dev.claimInterface(state.iface);
  } catch {
    throw new Error('프린터를 다른 프로그램이 쓰고 있어요. 매장 앱이나 다른 브라우저 탭을 닫고 다시 해주세요.');
  }
  try {
    const CHUNK = 4096;
    for (const job of jobs) {
      const bytes = job.data || job;          // Uint8Array 또는 {data, wait}
      for (let i = 0; i < bytes.length; i += CHUNK) {
        await dev.transferOut(state.endpoint, bytes.slice(i, i + CHUNK));
      }
      if (job.wait) await sleep(job.wait);
    }
  } finally {
    try { await dev.releaseInterface(state.iface); } catch {}
    try { await dev.close(); } catch {}
  }
}

const sendUSB = (bytes) => sendUSBJobs([bytes]);

function markConnected(on) {
  $('connectBtn').classList.toggle('on', on);
  $('connectTxt').textContent = on ? '연결됨' : '프린터 연결';
}

// ─────────── 매장 인쇄 서버 (같은 와이파이) ───────────
/** 이 페이지를 매장 서버가 서빙하고 있는지 확인 */
async function detectServer() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch('api/status', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const info = await res.json();
    if (info.mode !== 'server') return false;

    state.mode = 'server';
    $('connectBtn').classList.add('on');
    $('connectTxt').textContent = info.printer ? '매장 프린터' : '프린터 확인 필요';
    $('connectBtn').onclick = refreshServerStatus;
    $('hintText').innerHTML =
      '<b>매장 인쇄 서버</b>에 연결됐습니다. 인쇄 버튼을 누르면 매장 맥에 연결된 ' +
      'RP420에서 라벨이 나옵니다. 아이폰·안드로이드 모두 사용할 수 있어요.';
    return true;
  } catch {
    return false;
  }
}

async function refreshServerStatus() {
  try {
    const info = await (await fetch('api/status')).json();
    $('connectTxt').textContent = info.printer ? '매장 프린터' : '프린터 확인 필요';
    setStatus(info.printer ? '✓ 매장 프린터 연결됨' : '매장 맥에서 프린터 USB를 확인해주세요.');
  } catch { setStatus('매장 서버에 연결할 수 없어요.'); }
}

async function serverPost(path, body) {
  const res = await fetch('api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let info = {};
  try { info = await res.json(); } catch {}
  if (!res.ok || !info.ok) throw new Error(info.error || `서버 오류 (${res.status})`);
  return info;
}

// ─────────── 인쇄 동작 ───────────
async function doPrint() {
  if (!$('roasting').value.trim()) { setStatus('로스팅 포인트를 입력해주세요.'); return; }
  const copies = Math.max(1, Math.round(getStep('copies')));
  busy(true, '인쇄 중…');
  try {
    if (state.mode === 'server') {
      const bmp = labelToBitmap(buildOrder());
      await serverPost('print', {
        data: toBase64(bmp.data), height: bmp.height, copies,
      });
    } else {
      const bytes = labelToRaster(buildOrder());
      const jobs = [];
      // 정렬이 안 돼 있을 때만 캘리브 (빈 라벨 1장). 배출은 하지 않는다.
      if (!state.aligned) {
        for (const data of alignJobs()) jobs.push({ data, wait: ALIGN_WAIT });
      }
      for (let i = 0; i < copies; i++) jobs.push({ data: bytes, wait: 300 });
      await sendUSBJobs(jobs);
      state.aligned = true;
    }
    setStatus(`✓ 인쇄 완료 (${copies}장) · 뜯으려면 [배출]`);
  } catch (e) {
    setStatus('오류: ' + e.message);
  } finally { busy(false); }
}

async function doEject() {
  busy(true, '배출 중…');
  try {
    if (state.mode === 'server') await serverPost('eject');
    else await sendUSB(ejectCommand());
    state.aligned = false;      // 배출하면 정렬이 깨진다
    setStatus('✓ 배출 완료');
  } catch (e) { setStatus('오류: ' + e.message); }
  finally { busy(false); }
}

async function doCalibrate() {
  busy(true, '캘리브레이션 중… (라벨 1장 소비)');
  try {
    if (state.mode === 'server') {
      await serverPost('calibrate');
    } else {
      await sendUSB(calibrateCommand());
    }
    state.aligned = true;
    setStatus('✓ 캘리브레이션 완료');
  } catch (e) { setStatus('오류: ' + e.message); }
  finally { busy(false); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setStatus = (msg) => { $('status').textContent = msg; };
function busy(on, msg) {
  ['printBtn', 'ejectBtn', 'calibBtn'].forEach((id) => { $(id).disabled = on; });
  if (msg) setStatus(msg);
}

// ─────────── 커피 목록 ───────────
async function loadCoffees() {
  setStatus('커피 목록 불러오는 중…');
  try {
    const url = `${SUPABASE_URL}/rest/v1/coffees?select=id,name,flavor_notes&published=eq.true&order=created_at.desc`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      state.coffees = data;
      store.set('coffeeclub.printer.cache', data);
      setStatus('✅ 최신 정보로 업데이트됨');
    } else throw new Error('빈 응답');
  } catch {
    const cached = store.get('coffeeclub.printer.cache', []);
    if (cached.length) { state.coffees = cached; setStatus('⚠️ 오프라인 — 저장된 목록 사용 중'); }
    else { setStatus('커피 목록을 불러오지 못했어요.'); return; }
  }
  fillCoffeeSelect();
}

function fillCoffeeSelect() {
  const q = $('coffeeSearch').value.trim().toLowerCase();
  const list = q
    ? state.coffees.filter((c) => (c.name || '').toLowerCase().includes(q))
    : state.coffees;
  const sel = $('coffeeSelect');
  sel.innerHTML = '';
  if (!list.length) {
    sel.innerHTML = '<option>검색 결과 없음</option>';
    return;
  }
  for (const c of list) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name || '(이름 없음)';
    sel.appendChild(opt);
  }
  const keep = list.find((c) => c.id === state.current?.id);
  sel.value = (keep || list[0]).id;
  selectCoffee(sel.value);
}

function selectCoffee(id) {
  const c = state.coffees.find((x) => x.id === id);
  if (!c) return;
  state.current = c;
  $('flavor').textContent = c.flavor_notes || '—';
  loadSettings(id);
  render();
}

// ─────────── 설정 저장/불러오기 ───────────
// ※ 키 이름은 데스크톱 앱(printer_app.py)과 반드시 같아야 한다.
//    매장 서버가 맥의 ~/.coffeeclub_printer.json 을 그대로 넘겨주기 때문.
async function loadSettings(id) {
  const s = (await remote.load('settings'))[id] || {};
  $('roasting').value   = s.roasting ?? '';
  $('customText').value = s.custom_text ?? '';
  setStep('fsNum',    s.fs_num    ?? 18);
  setStep('fsMain',   s.fs_main   ?? 14);
  setStep('fsSub',    s.fs_sub    ?? 11);
  setStep('fsTiny',   s.fs_tiny   ?? 8);
  setStep('fsCustom', s.fs_custom ?? 11);
  setStep('lsSpin',   s.ls ?? 0);
  setStep('lgSpin',   s.lg ?? 0);
  if (s.font && FONTS[s.font]) $('fontSelect').value = s.font;

  state.qrType = s.qr_type ?? 0;
  $('qrCustom').value = s.qr_custom ?? '';
  paintQRSeg();

  const order = s.element_order;
  state.order = (order && order.length) ? order.filter((k) => ORDER_LABELS[k]) : DEFAULT_ORDER.slice();
  for (const k of DEFAULT_ORDER) if (!state.order.includes(k)) state.order.push(k);
  state.checked = new Set(s.element_checked ?? DEFAULT_ORDER);
  buildOrderList();

  $('visQR').checked      = s.show_qr      ?? true;
  $('visDetails').checked = s.show_details ?? true;
  $('dateCheck').checked  = s.date_check   ?? false;
  $('dateInput').value    = s.date || todayStr();
  syncDateInput();
  ensureFont();
}

async function saveSettings() {
  const id = state.current?.id;
  if (!id) { setStatus('커피를 먼저 선택해주세요.'); return; }
  const all = await remote.load('settings');
  all[id] = {
    roasting:    $('roasting').value.trim(),
    font:        $('fontSelect').value,
    date_check:  $('dateCheck').checked,
    date:        $('dateInput').value.trim(),
    fs_num: getStep('fsNum'), fs_main: getStep('fsMain'), fs_sub: getStep('fsSub'),
    fs_tiny: getStep('fsTiny'), fs_custom: getStep('fsCustom'),
    ls: getStep('lsSpin'), lg: getStep('lgSpin'),
    custom_text: $('customText').value,
    qr_type: state.qrType, qr_custom: $('qrCustom').value.trim(),
    element_order: state.order.slice(),
    element_checked: [...state.checked],
    show_qr: $('visQR').checked, show_details: $('visDetails').checked,
  };
  await remote.save('settings', all);
  setStatus(`✓ [${state.current.name}] 설정 저장 완료`
            + (state.mode === 'server' ? ' (매장 맥에 저장됨)' : ''));
}

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

// ─────────── 프리셋 (매장 서버 연결 시 맥의 파일 공유) ───────────
async function reloadPresets() {
  const presets = await remote.load('presets');
  const sel = $('presetSelect');
  const keep = sel.value;
  sel.innerHTML = '<option value="">— 프리셋 —</option>';
  for (const name of Object.keys(presets)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  }
  const want = state.preset || keep;
  if (want && presets[want]) sel.value = want;
}

/** 지금 어떤 프리셋을 수정 중인지 버튼에 표시 */
function markPreset() {
  const sel = $('presetSelect');
  if (sel.value !== (state.preset || '')) sel.value = state.preset || '';
  const btn = $('presetSave');
  btn.textContent = state.preset ? '수정' : '저장';
  btn.title = state.preset ? `[${state.preset}] 에 덮어쓰기` : '새 프리셋으로 저장';
}

// ─────────── 표시설정 리스트 (드래그 순서) ───────────
function buildOrderList() {
  const ul = $('orderList');
  ul.innerHTML = '';
  for (const key of state.order) {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.key = key;
    li.innerHTML =
      `<span class="grip">⠿</span>` +
      `<label class="chk"><input type="checkbox" ${state.checked.has(key) ? 'checked' : ''}>` +
      `<span class="box"></span></label>` +
      `<span class="name">${ORDER_LABELS[key]}</span>`;

    li.querySelector('input').onchange = (e) => {
      e.target.checked ? state.checked.add(key) : state.checked.delete(key);
      render();
    };
    li.addEventListener('dragstart', (e) => {
      li.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('drag');
      ul.querySelectorAll('li').forEach((x) => x.classList.remove('over'));
    });
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('over');
      const from = e.dataTransfer.getData('text/plain');
      const to = key;
      if (!from || from === to) return;
      const arr = state.order.filter((k) => k !== from);
      arr.splice(arr.indexOf(to), 0, from);
      state.order = arr;
      buildOrderList();
      render();
    });
    ul.appendChild(li);
  }
}

// ─────────── QR 세그먼트 ───────────
function paintQRSeg() {
  document.querySelectorAll('#qrSeg button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.i === state.qrType);
  });
  $('qrCustom').classList.toggle('hide', state.qrType !== 2);
}

// ─────────── 폰트 로딩 ───────────
async function ensureFont() {
  const fam = FONTS[$('fontSelect').value] || 'HangangM';
  try {
    await document.fonts.load(`20px "${fam}"`, '가나다ABC123');
    await document.fonts.ready;
  } catch {}
  render();
}

function syncDateInput() {
  $('dateInput').disabled = !$('dateCheck').checked;
}

/**
 * 폰 확대/축소 잠금
 * iOS Safari는 user-scalable=no 를 무시하므로 제스처를 직접 막는다.
 * 위아래 스크롤(pan-y)은 CSS 쪽에서 그대로 허용한다.
 */
function lockZoom() {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  // 두 손가락 벌리기 차단
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  // 더블탭 확대 차단
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch <= 320) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
}

// ─────────── 초기화 ───────────
function init() {
  lockZoom();
  // 폰트 셀렉트
  const fs = $('fontSelect');
  for (const name of Object.keys(FONTS)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    fs.appendChild(o);
  }
  fs.value = '서울한강 Regular';
  fs.onchange = ensureFont;

  // 스핀박스
  const g = $('fontSteps');
  makeStep(g, 'fsNum',  '로스팅',   18, 6, 40, 0.2, 1);
  makeStep(g, 'fsMain', '커피명',   14, 6, 40, 0.2, 1);
  makeStep(g, 'fsSub',  '맛노트',   11, 5, 24, 0.2, 1);
  makeStep(g, 'fsTiny', '자세히보기', 8, 4, 16, 0.2, 1);
  makeStep(g, 'lsSpin', '자간(px)',  0, -10, 20, 1, 0);
  makeStep(g, 'lgSpin', '행간(px)',  0, -10, 20, 1, 0);
  makeStep($('customSteps'), 'fsCustom', '추가텍스트', 11, 5, 24, 0.2, 1);
  makeStep($('copySteps'),   'copies',   '출력 장수',   1, 1, 30, 1, 0);

  // 이벤트
  $('refreshBtn').onclick = loadCoffees;
  $('coffeeSearch').oninput = fillCoffeeSelect;
  $('coffeeSelect').onchange = (e) => selectCoffee(e.target.value);
  $('saveBtn').onclick = saveSettings;
  $('roasting').oninput = render;
  $('customText').oninput = render;
  $('qrCustom').oninput = render;
  $('dateInput').oninput = render;
  $('dateCheck').onchange = () => { syncDateInput(); render(); };
  $('visQR').onchange = render;
  $('visDetails').onchange = render;
  $('dateInput').value = todayStr();

  document.querySelectorAll('#qrSeg button').forEach((b) => {
    b.onclick = () => { state.qrType = +b.dataset.i; paintQRSeg(); render(); };
  });

  $('presetSelect').onchange = async (e) => {
    const name = e.target.value;
    if (!name) { state.preset = null; markPreset(); return; }
    const presets = await remote.load('presets');
    if (presets[name] != null) {
      $('customText').value = presets[name];
      state.preset = name;          // 이 프리셋을 수정 중 → 저장하면 여기에 덮어쓴다
      markPreset();
      render();
    }
  };
  // 목록을 펼칠 때마다 최신 프리셋을 다시 읽는다 (맥에서 방금 추가한 것도 보이도록)
  $('presetSelect').onmousedown = () => { reloadPresets(); };
  // 저장: 불러온 프리셋이 있으면 이름을 묻지 않고 바로 그 프리셋에 덮어쓴다
  $('presetSave').onclick = async () => {
    const text = $('customText').value.trim();
    if (!text) { setStatus('저장할 텍스트를 먼저 입력해주세요.'); return; }

    let name = state.preset;
    if (!name) {
      const typed = prompt('프리셋 이름을 입력하세요:');
      if (!typed || !typed.trim()) return;
      name = typed.trim();
    }
    const presets = await remote.load('presets');
    const isUpdate = presets[name] != null;
    presets[name] = text;
    await remote.save('presets', presets);
    state.preset = name;
    await reloadPresets();
    markPreset();
    setStatus(`✓ [${name}] ${isUpdate ? '수정 저장됨' : '새 프리셋 저장됨'}`
              + (state.mode === 'server' ? ' · 매장 맥' : ''));
  };
  $('presetDel').onclick = async () => {
    const presets = await remote.load('presets');
    const names = Object.keys(presets);
    if (!names.length) { setStatus('저장된 프리셋이 없습니다.'); return; }
    // 불러온 프리셋이 있으면 그걸 지운다
    const target = state.preset || prompt(`삭제할 프리셋 이름:\n\n${names.join(', ')}`);
    if (!target || presets[target] == null) return;
    if (!confirm(`프리셋 [${target}] 을(를) 삭제할까요?`)) return;
    delete presets[target];
    await remote.save('presets', presets);
    state.preset = null;
    await reloadPresets();
    markPreset();
    setStatus(`✓ 프리셋 [${target}] 삭제됨`);
  };

  $('connectBtn').onclick = connectPrinter;
  $('printBtn').onclick = doPrint;
  $('ejectBtn').onclick = doEject;
  $('calibBtn').onclick = doCalibrate;

  // 매장 인쇄 서버가 서빙 중이면 서버 모드, 아니면 이 컴퓨터의 USB(WebUSB) 모드
  // 모드가 정해진 뒤에 프리셋·커피 목록을 읽어야 매장 맥의 파일을 가져온다
  detectServer().then((isServer) => {
    reloadPresets().then(markPreset);
    loadCoffees();
    if (isServer) return;
    if (usbSupported()) {
      navigator.usb.addEventListener('disconnect', (e) => {
        if (e.device === state.device) {
          state.device = null; markConnected(false);
          setStatus('프린터 연결이 끊어졌어요.');
        }
      });
      tryReconnect();
    } else {
      $('connectTxt').textContent = '인쇄 불가';
      $('hintText').innerHTML =
        '이 브라우저에서는 <b>편집·미리보기만</b> 가능합니다. 인쇄하려면 매장 맥에서 ' +
        '<b>폰인쇄서버</b>를 켠 뒤 그 주소로 접속하거나, 프린터가 연결된 컴퓨터의 Chrome에서 열어주세요.';
    }
  });

  state.order = DEFAULT_ORDER.slice();
  state.checked = new Set(DEFAULT_ORDER);
  buildOrderList();
  ensureFont();
}

document.addEventListener('DOMContentLoaded', init);

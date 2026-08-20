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
  device: null,
  endpoint: 1,
  order: DEFAULT_ORDER.slice(),
  checked: new Set(DEFAULT_ORDER),
};

const $ = (id) => document.getElementById(id);
const store = {
  get(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
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

async function openDevice(dev) {
  await dev.open();
  if (!dev.configuration) await dev.selectConfiguration(1);

  let ifaceNum = 0, endpoint = 1;
  for (const iface of dev.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === 'out');
      if (out) { ifaceNum = iface.interfaceNumber; endpoint = out.endpointNumber; break; }
    }
  }
  await dev.claimInterface(ifaceNum);
  state.device = dev;
  state.endpoint = endpoint;
  markConnected(true);
}

async function tryReconnect() {
  if (!usbSupported()) return;
  const list = await navigator.usb.getDevices();
  const dev = list.find((d) => d.vendorId === USB_VENDOR && d.productId === USB_PRODUCT);
  if (dev) { try { await openDevice(dev); } catch {} }
}

async function sendUSB(bytes) {
  if (!state.device) throw new Error('프린터가 연결되지 않았어요. [프린터 연결]을 먼저 눌러주세요.');
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await state.device.transferOut(state.endpoint, bytes.slice(i, i + CHUNK));
  }
}

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
      if (!store.get(LS_CALIB, false)) {
        await sendUSB(calibrateCommand());
        await sleep(1500);
        store.set(LS_CALIB, true);
      }
      const bytes = labelToRaster(buildOrder());
      for (let i = 0; i < copies; i++) {
        await sendUSB(bytes);
        await sleep(300);
      }
      await sendUSB(ejectCommand());
    }
    setStatus(`✓ 인쇄 완료 (${copies}장)`);
  } catch (e) {
    setStatus('오류: ' + e.message);
  } finally { busy(false); }
}

async function doEject() {
  busy(true, '배출 중…');
  try {
    if (state.mode === 'server') await serverPost('eject');
    else await sendUSB(ejectCommand());
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
      store.set(LS_CALIB, true);
    }
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
function loadSettings(id) {
  const s = (store.get(LS_SETTINGS, {}) || {})[id] || {};
  $('roasting').value   = s.roasting ?? '';
  $('customText').value = s.customText ?? '';
  setStep('fsNum',    s.fsNum    ?? 18);
  setStep('fsMain',   s.fsMain   ?? 14);
  setStep('fsSub',    s.fsSub    ?? 11);
  setStep('fsTiny',   s.fsTiny   ?? 8);
  setStep('fsCustom', s.fsCustom ?? 11);
  setStep('lsSpin',   s.ls ?? 0);
  setStep('lgSpin',   s.lg ?? 0);
  if (s.font && FONTS[s.font]) $('fontSelect').value = s.font;

  state.qrType = s.qrType ?? 0;
  $('qrCustom').value = s.qrCustom ?? '';
  paintQRSeg();

  state.order = (s.order && s.order.length) ? s.order.filter((k) => ORDER_LABELS[k]) : DEFAULT_ORDER.slice();
  for (const k of DEFAULT_ORDER) if (!state.order.includes(k)) state.order.push(k);
  state.checked = new Set(s.checked ?? DEFAULT_ORDER);
  buildOrderList();

  $('visQR').checked      = s.showQR      ?? true;
  $('visDetails').checked = s.showDetails ?? true;
  $('dateCheck').checked  = s.showDateRow ?? false;
  $('dateInput').value    = s.date || todayStr();
  syncDateInput();
  ensureFont();
}

function saveSettings() {
  const id = state.current?.id;
  if (!id) { setStatus('커피를 먼저 선택해주세요.'); return; }
  const all = store.get(LS_SETTINGS, {}) || {};
  all[id] = {
    roasting:   $('roasting').value.trim(),
    customText: $('customText').value,
    font:       $('fontSelect').value,
    fsNum: getStep('fsNum'), fsMain: getStep('fsMain'), fsSub: getStep('fsSub'),
    fsTiny: getStep('fsTiny'), fsCustom: getStep('fsCustom'),
    ls: getStep('lsSpin'), lg: getStep('lgSpin'),
    qrType: state.qrType, qrCustom: $('qrCustom').value.trim(),
    order: state.order.slice(),
    checked: [...state.checked],
    showQR: $('visQR').checked, showDetails: $('visDetails').checked,
    showDateRow: $('dateCheck').checked, date: $('dateInput').value.trim(),
  };
  store.set(LS_SETTINGS, all);
  setStatus(`✓ [${state.current.name}] 설정 저장 완료`);
}

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

// ─────────── 프리셋 ───────────
function reloadPresets() {
  const presets = store.get(LS_PRESETS, {}) || {};
  const sel = $('presetSelect');
  sel.innerHTML = '<option value="">— 프리셋 —</option>';
  for (const name of Object.keys(presets)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  }
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

// ─────────── 초기화 ───────────
function init() {
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

  $('presetSelect').onchange = (e) => {
    const name = e.target.value;
    if (!name) return;
    const presets = store.get(LS_PRESETS, {}) || {};
    if (presets[name] != null) { $('customText').value = presets[name]; render(); }
    e.target.value = '';
  };
  $('presetSave').onclick = () => {
    const text = $('customText').value.trim();
    if (!text) { setStatus('저장할 텍스트를 먼저 입력해주세요.'); return; }
    const name = prompt('프리셋 이름을 입력하세요:');
    if (!name || !name.trim()) return;
    const presets = store.get(LS_PRESETS, {}) || {};
    presets[name.trim()] = text;
    store.set(LS_PRESETS, presets);
    reloadPresets();
    setStatus(`✓ 프리셋 [${name.trim()}] 저장됨`);
  };
  $('presetDel').onclick = () => {
    const presets = store.get(LS_PRESETS, {}) || {};
    const names = Object.keys(presets);
    if (!names.length) { setStatus('저장된 프리셋이 없습니다.'); return; }
    const name = prompt(`삭제할 프리셋 이름:\n\n${names.join(', ')}`);
    if (!name || !presets[name]) return;
    delete presets[name];
    store.set(LS_PRESETS, presets);
    reloadPresets();
    setStatus(`✓ 프리셋 [${name}] 삭제됨`);
  };

  $('connectBtn').onclick = connectPrinter;
  $('printBtn').onclick = doPrint;
  $('ejectBtn').onclick = doEject;
  $('calibBtn').onclick = doCalibrate;

  // 매장 인쇄 서버가 서빙 중이면 서버 모드, 아니면 이 컴퓨터의 USB(WebUSB) 모드
  detectServer().then((isServer) => {
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
  reloadPresets();
  ensureFont();
  loadCoffees();
}

document.addEventListener('DOMContentLoaded', init);

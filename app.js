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
// 라벨 가로 위치 (dots). 1mm = 8 dots, 줄이면 종이 나오는 방향 기준 왼쪽으로 이동.
// 실기 확인: 130에서 오른쪽으로 0.5mm 치우쳐 126으로 맞췄다.
const LABEL_X = 126;
const LW = 240, LH = 120; // 라벨 30mm × 15mm (기본)
const GAP_MM = 3.0;
const DPMM = 203 / 25.4;

// 라벨 크기별 설정 — label_printer.py 의 LABEL_SPECS 와 반드시 같아야 한다
const LABEL_SPECS = {
  '30x15': { name: '30 × 15 mm', wMm: 30, hMm: 15, lw: 240, lh: 120,
             gapMm: 3.0, labelX: 126, backfeed: 312, ejectExtra: 36,
             pitchAdjust: 1, detail: false, divider: false,
             vertDx: 0, vertDy: 0, logo: false, logoH: 0,
             fonts: { fsNum: 18, fsMain: 14, fsSub: 11, fsTiny: 8, fsCustom: 11, fsDate: 11 } },
  '50x30': { name: '50 × 30 mm', wMm: 50, hMm: 30, lw: 400, lh: 240,
             gapMm: 3.0, labelX: 66,  backfeed: 704, ejectExtra: 36,
             pitchAdjust: 1, detail: true,  divider: true,
             // 세로형에서만 더해지는 보정 · QR 위 로고 (8도트 = 1mm)
             vertDx: 0, vertDy: 16, logo: true, logoH: 40,   // vertDy: 위를 2mm 내림
             // 라벨이 크니 전부 24로 시작한다
             fonts: { fsNum: 24, fsMain: 24, fsSub: 24, fsTiny: 24, fsCustom: 24, fsDate: 24 } },
};
const sizeSpec = (k) => LABEL_SPECS[k] || LABEL_SPECS['30x15'];

// ── QR 위에 올릴 로고 마크 ──
const LOGO_GAP = 5;
let logoImg = null;
(function loadLogo() {
  const im = new Image();
  // 초기화보다 먼저 도착할 수 있으므로 안전하게 다시 그린다
  im.onload  = () => { logoImg = im; try { render(); } catch (e) {} };
  im.onerror = () => { logoImg = null; };
  im.src = 'logo-mark.png';
})();

// 라벨 맨 위 형식 (한글, 영문)
const DRINK_TYPES = [
  ['커스텀 아메리카노',   'Custom Americano'],
  ['하이엔드 아메리카노', 'High-end Americano'],
  ['드립',               'Drip'],
  ['하이엔드 드립',       'High-end Drip'],
];
const drinkTypeText = (ko) => {
  const hit = DRINK_TYPES.find(([k]) => k === ko);
  return hit ? `${hit[0]}   ${hit[1]}` : (ko || '');
};

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
  type:            '🏷 형식',
  roasting_coffee: '☕ 로스팅 + 커피명',
  detail:          '🌱 기본정보',
  date:            '📅 날짜',
  note:            '✍️ 맛노트',
  custom:          '📝 추가텍스트',
};
const DEFAULT_ORDER = ['type', 'roasting_coffee', 'detail', 'note', 'date', 'custom'];

// ─────────── 상태 ───────────
const state = {
  coffees: [],
  current: null,
  qrType: 0,
  mode: 'usb',        // 'server' = 매장 인쇄 서버 경유 / 'usb' = 이 컴퓨터에 직접 연결
  aligned: false,     // 종이가 라벨 시작점에 맞춰져 있는지 (배출하면 깨짐)
  alignedSize: null,  // 어떤 라벨 크기로 맞춘 정렬인지 (크기가 바뀌면 다시 맞춰야 한다)
  ejectedDots: 0,     // 배출로 앞으로 밀어낸 양 — 되감을 때 더해야 한다
  preset: null,       // 지금 수정 중인 프리셋 이름 (저장하면 여기에 덮어쓴다)
  labelSize: '30x15', // 라벨 크기
  vertical: false,    // 세로형(글자 90도)
  drinkType: '',      // 맨 위 형식
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
 * 1순위 Supabase — 맥·폰·GitHub 주소 어디서 등록하든 같은 값을 본다.
 * 2순위 매장 서버(맥 파일) — Supabase가 안 될 때.
 * 3순위 브라우저 저장소 — 둘 다 안 될 때(오프라인).
 */
const SB_HEAD = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  'Content-Type': 'application/json',
};
const SB_TABLE = { presets: 'label_presets', settings: 'label_settings' };

const remote = {
  /** Supabase 행 목록 → {키: 값} 형태로 */
  _toMap(kind, rows) {
    const map = {};
    for (const r of rows) {
      if (kind === 'presets') map[r.name] = r.content;
      else map[r.coffee_id] = r.data;
    }
    return map;
  },

  async _sbLoad(kind) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${SB_TABLE[kind]}?select=*`,
      { headers: SB_HEAD },
    );
    if (!res.ok) throw new Error('supabase ' + res.status);
    return this._toMap(kind, await res.json());
  },

  async load(kind) {                       // kind: 'presets' | 'settings'
    try {
      const map = await this._sbLoad(kind);
      state.cloud = true;
      store.set(kind === 'presets' ? LS_PRESETS : LS_SETTINGS, map);   // 오프라인 대비 캐시
      return map;
    } catch {
      state.cloud = false;
    }
    if (state.mode === 'server') {
      try {
        const info = await (await fetch('api/' + kind)).json();
        if (info.ok) return info[kind] || {};
      } catch {}
    }
    // 저장소에 함께 올려둔 사본 — GitHub 주소에서도 맥의 프리셋을 볼 수 있게 한다
    try {
      const res = await fetch(`data/${kind}.json`, { cache: 'no-cache' });
      if (res.ok) {
        const map = await res.json();
        if (map && Object.keys(map).length) {
          const local = store.get(kind === 'presets' ? LS_PRESETS : LS_SETTINGS, {}) || {};
          return { ...map, ...local };     // 이 기기에서 추가한 것이 우선
        }
      }
    } catch {}
    return store.get(kind === 'presets' ? LS_PRESETS : LS_SETTINGS, {}) || {};
  },

  /** 바뀐 항목 하나만 올린다 (통째로 덮어쓰면 다른 기기 작업을 지운다) */
  async saveOne(kind, key, value) {
    const row = kind === 'presets'
      ? { name: key, content: value, updated_at: new Date().toISOString() }
      : { coffee_id: key, data: value, updated_at: new Date().toISOString() };
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${SB_TABLE[kind]}`, {
        method: 'POST',
        headers: { ...SB_HEAD, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error('supabase ' + res.status);
      state.cloud = true;
      return;
    } catch {
      state.cloud = false;
    }
    // Supabase가 안 되면: 매장 서버가 있으면 맥 파일에, 없으면 이 기기에만 기록
    if (state.mode === 'server') {
      const all = await this.load(kind);
      all[key] = value;
      await this.save(kind, all);
      return;
    }
    const LS = kind === 'presets' ? LS_PRESETS : LS_SETTINGS;
    const local = store.get(LS, {}) || {};
    local[key] = value;
    store.set(LS, local);
  },

  async deleteOne(kind, key) {
    const col = kind === 'presets' ? 'name' : 'coffee_id';
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${SB_TABLE[kind]}?${col}=eq.${encodeURIComponent(key)}`,
        { method: 'DELETE', headers: SB_HEAD },
      );
      if (!res.ok) throw new Error('supabase ' + res.status);
      return;
    } catch {}
    if (state.mode === 'server') {
      const all = await this.load(kind);
      delete all[key];
      await this.save(kind, all);
      return;
    }
    const LS = kind === 'presets' ? LS_PRESETS : LS_SETTINGS;
    const local = store.get(LS, {}) || {};
    delete local[key];
    store.set(LS, local);
  },

  /** 통째로 저장 (폴백 경로 전용) */
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

  // ── 폰: 숫자 위에서 위아래로 쓸어 값 조절 ──
  // 살짝 톡 치면 그대로 키보드 입력, 끌면 값이 바뀐다.
  const STEP_PX = 9;          // 이만큼 끌 때마다 한 칸
  let sy = 0, sv = 0, dragging = false, moved = false;
  input.addEventListener('touchstart', (e) => {
    sy = e.touches[0].clientY;
    sv = getStep(key);
    dragging = true; moved = false;
  }, { passive: true });
  input.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = sy - e.touches[0].clientY;      // 위로 끌면 +
    if (!moved && Math.abs(dy) < 6) return;    // 탭과 구분
    moved = true;
    e.preventDefault();                        // 페이지가 같이 움직이지 않게
    input.blur();                              // 끄는 중에는 키보드가 뜨지 않게
    setV(sv + Math.round(dy / STEP_PX) * step);
    render();
  }, { passive: false });
  const endDrag = () => { dragging = false; };
  input.addEventListener('touchend', endDrag);
  input.addEventListener('touchcancel', endDrag);

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
              key === 'fsTiny' || key === 'fsCustom' || key === 'fsDate')
             ? Number(v).toFixed(1) : String(Math.round(v));
};

// 라벨 크기에 맞는 기본 폰트 크기를 넣는다.
// 저장된 설정을 불러올 때는 부르지 않는다 — 저장값이 이겨야 한다.
function applySizeFonts(key) {
  const f = sizeSpec(key).fonts;
  if (!f) return;
  for (const [step, v] of Object.entries(f)) setStep(step, v);
}

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

/** 라벨을 흰 배경·검정 글씨로 그린다 (크기·세로형은 o 에서 결정) */
function renderLabel(ctx, o) {
  const ls = o.ls | 0, lg = o.lg | 0;
  const family = o.family;
  const sp = sizeSpec(o.size);
  const setFont = (px) => { ctx.font = `${px}px "${family}", sans-serif`; };

  // 세로형은 가로·세로를 바꿔 그린 뒤 마지막에 90도 돌린다
  const CW = o.vertical ? sp.lh : sp.lw;
  const CH = o.vertical ? sp.lw : sp.lh;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  const M = 8;
  // ── QR 위 로고 (50×30 에서만) ──
  const showLogo = !!(o.showQR && sp.logo && logoImg);
  const logoH    = showLogo ? sp.logoH : 0;
  const logoW    = showLogo ? Math.max(1, Math.round(logoH * logoImg.width / logoImg.height)) : 0;
  const logoBox  = showLogo ? logoH + LOGO_GAP : 0;   // QR 위로 비워둘 높이

  // 가로로 넓으면 QR을 오른쪽에, 세로로 길면 아래 가운데에
  const qrBottom = CH > CW;
  let QR_SIZE, qrX, qrY, textMaxW, MAX_Y;
  if (qrBottom) {
    QR_SIZE  = Math.min(Math.floor(CW * 0.62), Math.floor(CH / 3));
    qrX      = Math.floor((CW - QR_SIZE) / 2);
    qrY      = CH - QR_SIZE - (o.showDetails ? 14 : 4);
    textMaxW = CW - 8;
    MAX_Y    = o.showQR ? qrY - logoBox - 6 : CH - 2;
  } else {
    QR_SIZE  = Math.min(CH <= 130 ? 82 : Math.floor(CH * 0.42), CH - 2 * M - 14 - logoBox);
    qrX      = o.showQR ? CW - QR_SIZE - 6 : CW;
    qrY      = M + logoBox;
    textMaxW = o.showQR ? qrX - 8 : CW - 8;
    MAX_Y    = CH - 2;
  }

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
      ctx.drawImage(off, qrX, qrY, QR_SIZE, QR_SIZE);
    } catch (e) { /* QR 실패 시 건너뜀 */ }

    // ── QR 바로 위에 로고 마크 (QR 폭 기준 가운데) ──
    if (showLogo) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(logoImg, qrX + Math.floor((QR_SIZE - logoW) / 2),
                    qrY - LOGO_GAP - logoH, logoW, logoH);
    }

    // ── QR 아래: 자세히 보기 ▲ ──
    if (o.showDetails) {
      setFont(o.fsTiny);
      const label = '자세히 보기';
      const areaY = qrY + QR_SIZE + 4;
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
      if (sp.divider && o.showDivider && y + 4 < MAX_Y) {
        y -= 2;
        ctx.fillRect(tx, y, textMaxW - 4, 1);
        y += 6;
      }
    },
    date() {
      if (o.showDate && o.date) drawWrapped(o.date, o.fsDate, 4);
    },
    note() {
      if (o.showNote) drawWrapped(o.note, o.fsSub, 2);
    },
    custom() {
      const t = (o.customText || '').trim();
      if (o.showCustom && t) drawWrapped(t, o.fsCustom, 2);
    },
    type() {
      if (!o.showType) return;
      const t = drinkTypeText(o.drinkType);
      if (t) drawWrapped(t, o.fsSub, 2);
    },
    detail() {
      if (!o.showDetail) return;
      const rows = [];
      if (o.origin)   rows.push(['원산지', o.origin]);
      if (o.process)  rows.push(['가공',   o.process]);
      if (o.altitude) rows.push(['고도',   o.altitude]);
      if (o.variety)  rows.push(['품종',   o.variety]);
      for (const [t, v] of rows) drawWrapped(`${t}  ${v}`, o.fsSub, 1);
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
    origin:   d.origin || '',
    process:  d.processing || '',
    altitude: d.altitude || '',
    variety:  d.variety || '',
    date:     showDate ? $('dateInput').value.trim() : '',
    customText: $('customText').value,
    qrData:   qrURL(),
    family:   FONTS[$('fontSelect').value] || 'HangangM',
    fsNum:    getStep('fsNum'),
    fsMain:   getStep('fsMain'),
    fsSub:    getStep('fsSub'),
    fsTiny:   getStep('fsTiny'),
    fsCustom: getStep('fsCustom'),
    fsDate:   getStep('fsDate'),
    ls:       getStep('lsSpin'),
    lg:       getStep('lgSpin'),
    size:       state.labelSize,
    vertical:   state.vertical,
    drinkType:  state.drinkType,
    showType:   state.checked.has('type'),
    showDetail: state.checked.has('detail'),
    showDivider: true,
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

/** 라벨 1장을 실제 크기 캔버스로 만들어 준다 (세로형이면 회전까지) */
function renderLabelCanvas(o) {
  const sp = sizeSpec(o.size);
  const cv = document.createElement('canvas');
  cv.width = sp.lw; cv.height = sp.lh;
  const ctx = cv.getContext('2d');
  if (!o.vertical) {
    renderLabel(ctx, o);
    return cv;
  }
  // 세로로 그린 뒤 시계방향 90도 회전해 붙인다
  const off = document.createElement('canvas');
  off.width = sp.lh; off.height = sp.lw;
  renderLabel(off.getContext('2d'), o);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.translate(cv.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(off, 0, 0);
  ctx.restore();
  return cv;
}

// ─────────── 미리보기 ───────────
let renderPending = false;
function render() {
  if (renderPending) return;
  renderPending = true;
  // 화면이 숨겨지면 requestAnimationFrame 이 멈춘다.
  // 그대로 두면 renderPending 이 true 로 고착돼 미리보기가 영영 갱신되지 않으므로
  // 타이머도 함께 걸어 먼저 오는 쪽이 그린다.
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    renderPending = false;
    const o = buildOrder();
    const off = renderLabelCanvas(o);

    const cv = $('previewCanvas');
    if (cv.width !== off.width * 3 || cv.height !== off.height * 3) {
      cv.width = off.width * 3; cv.height = off.height * 3;   // 라벨 비율 유지
    }
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
  };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

// ─────────── 라벨 → 1비트 비트맵 ───────────
function labelToBitmap(o) {
  const sp     = sizeSpec(o.size);
  const gapPx  = Math.round(sp.gapMm * DPMM);
  const height = sp.lh + gapPx;

  const cv = document.createElement('canvas');
  cv.width = W_FULL; cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W_FULL, height);

  const off = renderLabelCanvas(o);
  ctx.imageSmoothingEnabled = false;
  // 세로형은 내용이 네 변에 꽉 차서 가로형과 같은 위치로는 잘린다
  const dx = o.vertical ? (sp.vertDx | 0) : 0;
  const dy = o.vertical ? (sp.vertDy | 0) : 0;
  ctx.drawImage(off, sp.labelX + dx, dy);

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
  const sp    = sizeSpec(state.labelSize);
  const gapPx = Math.round(sp.gapMm * DPMM);
  const rows  = Math.max(1, sp.lh + gapPx - 32);
  const bytesPerRow = W_FULL / 8;
  return rasterCommand(bytesPerRow, rows, new Uint8Array(bytesPerRow * rows));
}

/**
 * 연속 인쇄 피치 보정
 * 한 장에 144 dots(18.02mm)를 보내는데 실제 라벨 피치가 그보다 조금 크다.
 * 보정하지 않으면 장이 넘어갈수록 인쇄가 위로 밀려 위쪽이 잘린다.
 * 실기 테스트에서 장당 +1 dot 이 정확했다.
 */
function pitchFeedCommand() {
  const n = sizeSpec(state.labelSize).pitchAdjust;
  const bytesPerRow = W_FULL / 8;
  return rasterCommand(bytesPerRow, n, new Uint8Array(bytesPerRow * n));
}

const calibrateCommand = () => {
  const sp = sizeSpec(state.labelSize);
  return new TextEncoder().encode(
    `SIZE ${sp.wMm} mm,${sp.hMm} mm\r\nGAP ${sp.gapMm} mm,0 mm\r\nCLS\r\nPRINT 1\r\n`);
};

/**
 * 인쇄 전 라벨 위치 자동 정렬 (버려지는 라벨 없음)
 *
 * 이 프린터는 래스터 인쇄 때 갭 센서를 쓰지 않아 위치가 어긋난다.
 * 갭센서 캘리브(CLS+PRINT 1)만 정확히 맞고, 그때 빈 라벨이 한 장 밀려나오는데
 * BACKFEED 로 되감아 그 라벨을 그대로 다시 쓴다.
 *
 * ★ 두 값 모두 실기로 찾은 것 — 바꾸려면 실제로 인쇄해 확인할 것.
 *   · ALIGN_WAIT 2000ms 로는 어긋나고 2500ms 에서 맞는다.
 *   · BACKFEED 288이면 3mm 밀리고 312가 정확하다.
 */
const ALIGN_WAIT = 2500;
const BACKFEED_AFTER_ALIGN = 312;
// 배출한 뒤에는 종이가 더 나가 있어 그만큼(+보정) 더 되감아야 한다.
// 배출 이송량 112만 더하면 4.5mm 밀려서 36을 더한다. 둘 다 실기로 찾은 값.
const EJECT_BACKFEED_EXTRA = 36;
const backfeedCommand = (dots) => new TextEncoder().encode(`BACKFEED ${dots}\r\n`);
const alignJobs = () => {
  const sp = sizeSpec(state.labelSize);
  let back = sp.backfeed + state.ejectedDots;
  if (state.ejectedDots) back += sp.ejectExtra;
  state.ejectedDots = 0;
  return [calibrateCommand(), backfeedCommand(back)];
};

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
        size: state.labelSize,   // 크기마다 정렬 값이 다르다 — 반드시 같이 보낸다
      });
    } else {
      const bytes = labelToRaster(buildOrder());
      const jobs = [];
      // 정렬이 안 돼 있을 때만 캘리브 (빈 라벨 1장). 배출은 하지 않는다.
      if (!state.aligned || state.alignedSize !== state.labelSize) {
        for (const data of alignJobs()) jobs.push({ data, wait: ALIGN_WAIT });
      }
      for (let i = 0; i < copies; i++) {
        jobs.push({ data: bytes });
        if (sizeSpec(state.labelSize).pitchAdjust) {
          jobs.push({ data: pitchFeedCommand(), wait: 300 });
        }
      }
      await sendUSBJobs(jobs);
      state.aligned = true;
      state.alignedSize = state.labelSize;
    }
    setStatus(`✓ 인쇄 완료 (${copies}장) · 뜯으려면 [배출]`);
  } catch (e) {
    setStatus('오류: ' + e.message);
  } finally { busy(false); }
}

async function doEject() {
  busy(true, '배출 중…');
  try {
    if (state.mode === 'server') await serverPost('eject', { size: state.labelSize });
    else await sendUSB(ejectCommand());
    state.aligned = false;      // 배출하면 정렬이 깨진다
    {
      const sp = sizeSpec(state.labelSize);
      state.ejectedDots += Math.max(1, sp.lh + Math.round(sp.gapMm * DPMM) - 32);
    }
    setStatus('✓ 배출 완료');
  } catch (e) { setStatus('오류: ' + e.message); }
  finally { busy(false); }
}

async function doCalibrate() {
  busy(true, '캘리브레이션 중… (라벨 1장 소비)');
  try {
    if (state.mode === 'server') {
      await serverPost('calibrate', { size: state.labelSize });
    } else {
      await sendUSB(calibrateCommand());
    }
    state.aligned = true;
    state.alignedSize = state.labelSize;
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
    const url = `${SUPABASE_URL}/rest/v1/coffees?select=id,name,flavor_notes,origin,processing,altitude,variety&published=eq.true&order=created_at.desc`;
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
  setStep('fsDate',   s.fs_date ?? s.fs_sub ?? 11);
  state.labelSize = LABEL_SPECS[s.label_size] ? s.label_size : '30x15';
  state.vertical  = !!s.vertical;
  state.drinkType = s.drink_type || '';
  document.querySelectorAll('#sizeSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.key === state.labelSize));
  document.querySelectorAll('#dirSeg button').forEach((b) =>
    b.classList.toggle('on', (b.dataset.v === '1') === state.vertical));
  $('typeSelect').value = state.drinkType;
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
  const entry = {
    roasting:    $('roasting').value.trim(),
    font:        $('fontSelect').value,
    date_check:  $('dateCheck').checked,
    date:        $('dateInput').value.trim(),
    fs_num: getStep('fsNum'), fs_main: getStep('fsMain'), fs_sub: getStep('fsSub'),
    fs_tiny: getStep('fsTiny'), fs_custom: getStep('fsCustom'),
    fs_date: getStep('fsDate'),
    label_size: state.labelSize,
    vertical: state.vertical,
    drink_type: state.drinkType,
    ls: getStep('lsSpin'), lg: getStep('lgSpin'),
    custom_text: $('customText').value,
    qr_type: state.qrType, qr_custom: $('qrCustom').value.trim(),
    element_order: state.order.slice(),
    element_checked: [...state.checked],
    show_qr: $('visQR').checked, show_details: $('visDetails').checked,
  };
  await remote.saveOne('settings', id, entry);
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

// ─────────── 표시설정 리스트 (순서 변경) ───────────
/** 손가락으로도 쓸 수 있게 ▲▼ 버튼으로 한 칸씩 이동 */
function moveOrder(key, dir) {
  const i = state.order.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.order.length) return;
  [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
  buildOrderList();
  render();
}

function buildOrderList() {
  const ul = $('orderList');
  ul.innerHTML = '';
  state.order.forEach((key, idx) => {
    const li = document.createElement('li');
    li.draggable = true;        // 데스크톱에서는 드래그도 그대로 쓸 수 있게
    li.dataset.key = key;
    li.innerHTML =
      `<label class="chk"><input type="checkbox" ${state.checked.has(key) ? 'checked' : ''}>` +
      `<span class="box"></span></label>` +
      `<span class="name">${ORDER_LABELS[key]}</span>` +
      `<span class="move">` +
      `<button type="button" class="up" ${idx === 0 ? 'disabled' : ''} aria-label="위로">▲</button>` +
      `<button type="button" class="down" ${idx === state.order.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button>` +
      `</span>`;

    li.querySelector('.up').onclick   = () => moveOrder(key, -1);
    li.querySelector('.down').onclick = () => moveOrder(key, +1);

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
  });
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
  makeStep(g, 'fsSub',  '맛노트',   11, 5, 40, 0.2, 1);
  makeStep(g, 'fsTiny', '자세히보기', 8, 4, 40, 0.2, 1);
  makeStep(g, 'fsDate', '날짜',     11, 5, 40, 0.2, 1);
  makeStep(g, 'lsSpin', '자간(px)',  0, -10, 20, 1, 0);
  makeStep(g, 'lgSpin', '행간(px)',  0, -10, 20, 1, 0);
  makeStep($('customSteps'), 'fsCustom', '추가텍스트', 11, 5, 40, 0.2, 1);
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

  // 라벨 크기
  const sizeSeg = $('sizeSeg');
  for (const [key, sp] of Object.entries(LABEL_SPECS)) {
    const b = document.createElement('button');
    b.textContent = sp.name;
    b.dataset.key = key;
    if (key === state.labelSize) b.classList.add('on');
    b.onclick = () => {
      state.labelSize = key;
      sizeSeg.querySelectorAll('button').forEach((x) =>
        x.classList.toggle('on', x.dataset.key === key));
      applySizeFonts(key);
      render();
    };
    sizeSeg.appendChild(b);
  }

  // 방향
  document.querySelectorAll('#dirSeg button').forEach((b) => {
    b.onclick = () => {
      state.vertical = b.dataset.v === '1';
      document.querySelectorAll('#dirSeg button').forEach((x) =>
        x.classList.toggle('on', x === b));
      render();
    };
  });

  // 형식
  const typeSel = $('typeSelect');
  for (const [ko, en] of DRINK_TYPES) {
    const o = document.createElement('option');
    o.value = ko; o.textContent = `${ko}  (${en})`;
    typeSel.appendChild(o);
  }
  typeSel.onchange = () => { state.drinkType = typeSel.value; render(); };

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
    await remote.saveOne('presets', name, text);
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
    await remote.deleteOne('presets', target);
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
    // 매장 서버가 아니면 맥에 저장된 프리셋·설정을 가져올 수 없다
    const offsite =
      '<b>매장 맥에 연결돼 있지 않습니다.</b> 그래서 맥에 저장한 <b>프리셋과 커피별 설정이 보이지 않습니다.</b><br>' +
      '매장에서 쓰시려면 앱의 <b>폰에서 인쇄</b>를 켜고 거기 표시된 주소(<code>…:9110</code>)로 접속하세요.';

    if (usbSupported()) {
      navigator.usb.addEventListener('disconnect', (e) => {
        if (e.device === state.device) {
          state.device = null; markConnected(false);
          setStatus('프린터 연결이 끊어졌어요.');
        }
      });
      tryReconnect();
      $('hintText').innerHTML = offsite +
        '<br><br>이 컴퓨터에 프린터가 USB로 꽂혀 있다면 <b>프린터 연결</b>을 눌러 바로 인쇄할 수 있습니다.';
    } else {
      $('connectTxt').textContent = '인쇄 불가';
      $('hintText').innerHTML = offsite +
        '<br><br>이 브라우저에서는 <b>편집·미리보기만</b> 됩니다.';
    }
  });

  state.order = DEFAULT_ORDER.slice();
  state.checked = new Set(DEFAULT_ORDER);
  buildOrderList();
  ensureFont();
}

document.addEventListener('DOMContentLoaded', init);

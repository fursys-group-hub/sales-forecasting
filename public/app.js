const MONTHS = [
  { ym: '202610', label: '26.10월' },
  { ym: '202611', label: '26.11월' },
  { ym: '202612', label: '26.12월' },
  { ym: '202701', label: '27.01월' },
  { ym: '202702', label: '27.02월' },
  { ym: '202703', label: '27.03월' },
  { ym: '202704', label: '27.04월' },
];

// Holt-Winters 예측 시 이미 계산해둔 90% 예측구간 고정 수치 (2026-07-03).
// 중심값은 여기 저장하지 않고 서버의 assumptions[ym].reference_growth를 그대로 사용한다 —
// 같은 숫자를 두 곳에 저장하면 나중에 한쪽만 갱신하고 다른 쪽을 깜빡하는 사고가 남는다.
const REFERENCE_GROWTH_RANGE = {
  '202610': { low: -0.113, high: 0.192 },
  '202611': { low: -0.189, high: 0.128 },
  '202612': { low: -0.202, high: 0.088 },
  '202701': { low: -0.167, high: 0.119 },
  '202702': { low: -0.218, high: 0.028 },
  '202703': { low: -0.169, high: 0.085 },
  '202704': { low: -0.127, high: 0.197 },
};

const EXT_VARS = [
  {
    title: '소비자심리지수(CCSI)',
    value: '26.6월 106.6 (2개월 연속 상승, 4월 99.2 급락 후 반등). 주택가격전망CSI 120(3개월 연속↑), 물가전망CSI 150',
    impl: '개선 추세지만 물가·주택가격 부담 상존 → 기본 시나리오 근거',
    src: '한국은행 소비자동향조사(2026.6)',
  },
  {
    title: '기준금리',
    value: '2.50% 유지(8회 연속 동결) 중, 하반기 인상 가능성 시사(점도표 6개월 후 3.00%↑ 다수)',
    impl: '인상 시 가구 소비 위축 리스크 → 보수적 조정 근거',
    src: '한국은행 금융통화위원회(2026.5)',
  },
  {
    title: '아파트 입주물량',
    value: '26년 전국 18만가구(전년比 -28%), 서울 -26~48% 급감. 27년은 전국 19.2만가구로 유지',
    impl: '이사철 수요 감소 압력, 단 서울 신축 희소성으로 대단지 입주월 수요 집중 가능',
    src: '부동산R114·KB부동산(2026)',
  },
  {
    title: '수면·매트리스 시장 규모',
    value: '한국 수면시장 2026년 4조원 규모 전망, 프리미엄 매트리스 수요 지속 확대',
    impl: '카테고리 성장은 우호적 (단 경쟁 심화)',
    src: '한국수면산업협회(2026)',
  },
  {
    title: '가구업계 전반 실적',
    value: '2025년 주택 인허가·착공·준공 모두 감소, 인테리어·가구업계 실적 둔화 보도 병존',
    impl: '매트리스 성장과 업계 전반 부진이 엇갈리는 신호 → 중립 유지 권장',
    src: '월간 THE LIVING(2026)',
  },
];

// 실적/예상/확정예측은 진한(불투명) 색, 잠정예측만 옅은 색으로 — "아직 안 정해짐"을 시각적으로 구분
const TREND_STATUS_META = {
  actual: { label: '실적', color: '#1f3864' },
  estimate: { label: '예상', color: '#3d6690' },
  confirmed: { label: '확정예측', color: '#2e7d4f' },
  provisional: { label: '잠정예측', color: '#f0c48a' },
};

const GROWTH_LINE_COLOR = '#8a93a6';

const POLL_INTERVAL_MS = 60000;

let state = null;
let chart = null;
let realtimeDebounceTimer = null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return `${(Number(n) * 100).toFixed(digits)}%`;
}
function fmtPctSigned(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  const pct = Number(n) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

function showToast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function setSyncStatus(mode) {
  const s = $('#syncStatus');
  s.className = 'sync-status' + (mode === 'saving' ? ' saving' : mode === 'error' ? ' error' : '');
}

// ---------------- Rendering ----------------

function shortLabel(year, month) {
  return `${String(year).slice(2)}.${String(month).padStart(2, '0')}`;
}

// 25.1월~26.9월(historicalSales, 실적/예상) + 26.10월~27.4월(forecast.months, 잠정/확정)을
// 하나의 연속된 시계열로 합쳐 단일 라인차트에 꽂는다.
// growth(YoY)는 26.1월부터만 계산 가능 — 25년 구간은 전년 데이터가 없어 null(빈 값)로 둔다.
// 26.10월 이후는 새로 계산하지 않고 카드에 이미 쓰고 있는 effectiveGrowth(최종협의 or 로직근거)를 그대로 재사용.
function buildTrendPoints(historicalSales, forecastMonths) {
  const revenueByYearMonth = {};
  historicalSales.forEach((r) => { revenueByYearMonth[`${r.year}-${r.month}`] = r.revenue; });

  const histPoints = historicalSales.map((r) => {
    const priorRevenue = revenueByYearMonth[`${r.year - 1}-${r.month}`];
    return {
      label: shortLabel(r.year, r.month),
      value: r.revenue,
      status: r.type === '실적' ? 'actual' : 'estimate',
      growth: priorRevenue !== undefined ? r.revenue / priorRevenue - 1 : null,
    };
  });
  const forecastPoints = forecastMonths.map((m) => {
    const year = Number(m.ym.slice(0, 4));
    const month = Number(m.ym.slice(4, 6));
    return {
      label: shortLabel(year, month),
      value: m.revenue,
      status: m.isFinal ? 'confirmed' : 'provisional',
      growth: m.effectiveGrowth,
    };
  });
  return [...histPoints, ...forecastPoints];
}

function renderChartLegend() {
  const wrap = $('#chartLegend');
  wrap.innerHTML = '';
  const items = [
    ...Object.values(TREND_STATUS_META),
    { label: 'YoY 성장률(우측 축)', color: GROWTH_LINE_COLOR },
  ];
  items.forEach((meta) => {
    const item = el('span', 'chart-legend-item');
    const dot = el('span', 'chart-legend-dot');
    dot.style.background = meta.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(meta.label));
    wrap.appendChild(item);
  });
}

function renderTrendChart(historicalSales, forecastMonths) {
  if (typeof Chart === 'undefined') {
    // Chart.js CDN을 못 불러온 경우(사내망 차단 등) — 차트만 생략하고 나머지는 정상 렌더되도록 함
    renderChartLegend();
    return;
  }
  const points = buildTrendPoints(historicalSales, forecastMonths);
  const forecastStartIndex = historicalSales.length; // 26.10월(첫 예측월)의 인덱스

  const labels = points.map((p) => p.label);
  const data = points.map((p) => p.value);
  const barColors = points.map((p) => TREND_STATUS_META[p.status].color);

  // 매출 = 막대(왼쪽 축). 실적/예상/확정예측은 진한 색, 잠정예측은 옅은 색으로 구간을 구분
  // (26.10월부터 어차피 색이 바뀌므로 별도 점선 처리는 필요 없음).
  const revenueDataset = {
    type: 'bar',
    label: '매출',
    yAxisID: 'y',
    order: 2,
    data,
    backgroundColor: barColors,
    borderRadius: 2,
    maxBarThickness: 28,
  };

  // YoY 성장률 = 꺾은선(오른쪽 보조 축). 26.1월부터만 값이 있고(그 이전은 null이라 선이 자동으로
  // 끊김), 26.10월부터는 매출과 동일하게 점선으로 바뀐다. 막대 위에 겹쳐 그려지도록 order를 낮게.
  const growthDataset = {
    type: 'line',
    label: 'YoY 성장률',
    yAxisID: 'y1',
    order: 1,
    data: points.map((p) => p.growth),
    borderColor: GROWTH_LINE_COLOR,
    backgroundColor: GROWTH_LINE_COLOR,
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0.2,
    segment: {
      borderDash: (ctx) => (ctx.p1DataIndex >= forecastStartIndex ? [6, 4] : undefined),
    },
  };

  const ctx = document.getElementById('forecastChart').getContext('2d');
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (item) => !(item.dataset.yAxisID === 'y1' && (item.raw === null || item.raw === undefined)),
        callbacks: {
          label: (tctx) => {
            const p = points[tctx.dataIndex];
            // 값 자체는 tctx.raw(현재 차트 데이터)를 읽는다 — 카드의 하한/중심/상한 토글이
            // 매출/성장률 미리보기 값을 차트 데이터에 직접 반영하므로, 여기서 p.value/p.growth를
            // 쓰면 토글 클릭 이후 툴팁이 미리보기 이전 값을 보여주는 불일치가 생긴다.
            if (tctx.dataset.yAxisID === 'y1') return `YoY 성장률: ${fmtPct(tctx.raw)}`;
            return `${TREND_STATUS_META[p.status].label}: ${fmtNum(tctx.raw, 1)} 백만원`;
          },
        },
      },
    },
    scales: {
      y: {
        position: 'left',
        ticks: { callback: (v) => v.toLocaleString('ko-KR') },
        title: { display: true, text: '매출 (백만원)' },
      },
      y1: {
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { callback: (v) => `${(v * 100).toFixed(0)}%` },
        title: { display: true, text: 'YoY 성장률' },
      },
      x: { ticks: { autoSkip: true, maxTicksLimit: 14, maxRotation: 60, minRotation: 0 } },
    },
  };

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = [revenueDataset, growthDataset];
    chart.options = options;
    chart.update('none');
  } else {
    chart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [revenueDataset, growthDataset] }, options });
  }

  renderChartLegend();
}

// 카드의 하한/중심/상한 토글 클릭 시, 왼쪽 매출 추이 차트의 해당 월 막대(매출)와
// 꺾은선(YoY 성장률)도 같이 미리보기로 반영한다. 서버 재요청/저장 없이 Chart.js
// 데이터 배열만 직접 수정 — 다음 renderAll(폴링/저장 응답)이 오면 실제 값으로 되돌아간다.
function updateChartPreview(ym, revenue, growth) {
  if (!chart || !state) return;
  const monthIndex = MONTHS.findIndex((m) => m.ym === ym);
  if (monthIndex === -1) return;
  const idx = state.historicalSales.length + monthIndex;
  chart.data.datasets[0].data[idx] = revenue;
  chart.data.datasets[1].data[idx] = growth;
  chart.update('none');
}

// 대외변수 참고 — 모든 월에 공통이라 카드 그리드 위쪽에 한 번만 렌더 (정적 콘텐츠, state와 무관)
function renderExtVarsSection() {
  const c = $('#extVarsSection');
  c.innerHTML = '';
  EXT_VARS.forEach((v) => {
    const card = el('div', 'extvar-card');
    card.appendChild(el('h4', null, v.title));
    card.appendChild(el('p', null, v.value));
    card.appendChild(el('p', 'impl', v.impl));
    card.appendChild(el('p', 'src', `출처: ${v.src}`));
    c.appendChild(card);
  });
}

function freeTextRow(ym, field, label, placeholder, value) {
  const row = el('div', 'mc-row mc-context');
  row.appendChild(el('label', 'mc-row-label', label));
  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.dataset.ym = ym;
  textarea.dataset.field = field;
  textarea.placeholder = placeholder;
  textarea.value = value || '';
  textarea.dataset.savedValue = textarea.value;
  textarea.addEventListener('blur', () => onFreeTextBlur(ym, field, textarea));
  row.appendChild(textarea);
  return row;
}

function monthCard(m) {
  const card = el('div', 'month-card');
  card.dataset.ym = m.ym;

  const head = el('div', 'month-card-head');
  head.appendChild(el('div', 'month-label', m.label));
  head.appendChild(el('div', 'prior-value', `전년동월 ${fmtNum(m.priorValue, 1)}백만원`));
  card.appendChild(head);

  // 예상 매출 값 엘리먼트 — 아래서 카드에 append하지만, 하한/중심/상한 토글 클릭 시
  // 이 값을 직접 갱신해야 해서 참조를 먼저 만들어둔다 (서버 재요청 없이 로컬 미리보기).
  const revValueEl = el('div', 'mc-row-value big', `${fmtNum(m.revenue, 1)} 백만원`);

  // 로직 근거 성장률 — 최종 협의 전(잠정): 하한/중심/상한 3버튼 토글로 시나리오 미리보기.
  // 최종 협의 후: 이미 확정 매출을 보여주고 있으므로 토글은 의미가 없어 참고용 단일값만 표시.
  const range = REFERENCE_GROWTH_RANGE[m.ym];
  const refRow = el('div', 'mc-row mc-reference' + (m.isFinal ? '' : ' mc-muted'));
  refRow.appendChild(el('div', 'mc-row-label', '로직 근거 성장률' + (m.isFinal ? '' : ' (잠정)')));

  if (!m.isFinal && range) {
    const toggle = el('div', 'mc-bound-toggle');
    const bounds = [
      { key: 'low', label: '하한', growth: range.low },
      { key: 'center', label: '중심', growth: m.referenceGrowth },
      { key: 'high', label: '상한', growth: range.high },
    ];
    let selectedKey = 'center';
    const buttons = bounds.map((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mc-bound-btn' + (b.key === selectedKey ? ' active' : '');
      btn.textContent = `${b.label} ${fmtPctSigned(b.growth)}`;
      btn.addEventListener('click', () => {
        selectedKey = b.key;
        buttons.forEach((otherBtn, i) => otherBtn.classList.toggle('active', bounds[i].key === selectedKey));
        const previewRevenue = m.priorValue * (1 + b.growth);
        revValueEl.textContent = `${fmtNum(previewRevenue, 1)} 백만원`;
        updateChartPreview(m.ym, previewRevenue, b.growth);
      });
      toggle.appendChild(btn);
      return btn;
    });
    refRow.appendChild(toggle);
  } else {
    refRow.appendChild(el('div', 'mc-row-value', fmtPct(m.referenceGrowth)));
  }

  const refNote = el('div', 'mc-row-note', m.referenceRationale);
  refNote.title = m.referenceRationale;
  refRow.appendChild(refNote);
  card.appendChild(refRow);

  // 매장(유통) 변동 / 신제품 출시 (짧은 자유서술 2칸, blur 시 저장)
  card.appendChild(freeTextRow(m.ym, 'store_change', '매장(유통) 변동', '예: OO점 신규 오픈, XX몰 입점 등', m.storeChange));
  card.appendChild(freeTextRow(m.ym, 'new_product', '신제품 출시', '예: 프리미엄 매트리스 신모델 출시', m.newProduct));

  // 최종 협의 성장률
  const finalRow = el('div', 'mc-row mc-final');
  const finalLabelWrap = el('label', 'mc-row-label', '최종 협의 성장률 ');
  if (!m.isFinal) finalLabelWrap.appendChild(el('span', 'badge-unconfirmed', '미확정'));
  finalRow.appendChild(finalLabelWrap);
  const finalInputWrap = el('div', 'mc-final-input');
  const finalInput = document.createElement('input');
  finalInput.type = 'number';
  finalInput.step = '0.1';
  finalInput.dataset.ym = m.ym;
  finalInput.dataset.field = 'final_growth';
  finalInput.placeholder = '미확정';
  finalInput.value = m.isFinal ? (m.finalGrowth * 100).toFixed(1) : '';
  finalInput.addEventListener('change', () => onFinalGrowthChange(m.ym, finalInput));
  finalInputWrap.appendChild(finalInput);
  finalInputWrap.appendChild(el('span', 'unit', '%'));
  finalRow.appendChild(finalInputWrap);
  card.appendChild(finalRow);

  // 예상 매출
  const revRow = el('div', 'mc-row mc-revenue');
  const revLabel = el('div', 'mc-row-label', '예상 매출 ');
  if (!m.isFinal) revLabel.appendChild(el('span', 'tag-provisional', '(잠정)'));
  revRow.appendChild(revLabel);
  revRow.appendChild(revValueEl);
  card.appendChild(revRow);

  return card;
}

function summaryCard(totals) {
  const card = el('div', 'month-card month-summary');
  card.appendChild(el('div', 'month-card-head'));
  card.querySelector('.month-card-head').appendChild(el('div', 'month-label', '합계 (26.10~27.4)'));

  const addRow = (label, value, big) => {
    const row = el('div', 'mc-row');
    row.appendChild(el('div', 'mc-row-label', label));
    row.appendChild(el('div', 'mc-row-value' + (big ? ' big' : ''), value));
    card.appendChild(row);
  };

  addRow('전년동기 합계', `${fmtNum(totals.priorTotal, 0)} 백만원`);
  addRow('예상 합계', `${fmtNum(totals.revenueTotal, 0)} 백만원`, true);
  addRow('26.10~12월 예상', `${fmtNum(totals.revenueOct2Dec, 0)} 백만원`);
  addRow('27.1~4월 예상', `${fmtNum(totals.revenueJan2Apr, 0)} 백만원`);

  return card;
}

function renderMonthBoard(forecast) {
  const board = $('#monthBoard');
  board.innerHTML = '';
  forecast.months.forEach((m) => board.appendChild(monthCard(m)));
  board.appendChild(summaryCard(forecast.totals));
}

function currentFocusInfo() {
  const active = document.activeElement;
  if (active && active.dataset && active.dataset.ym && active.dataset.field) {
    return {
      ym: active.dataset.ym,
      field: active.dataset.field,
      value: active.value,
      selStart: active.selectionStart,
      selEnd: active.selectionEnd,
    };
  }
  return null;
}

function restoreFocus(info) {
  if (!info) return;
  const target = document.querySelector(`[data-ym="${info.ym}"][data-field="${info.field}"]`);
  if (!target) return;
  target.value = info.value;
  target.focus();
  if (typeof info.selStart === 'number' && target.setSelectionRange) {
    try { target.setSelectionRange(info.selStart, info.selEnd); } catch (err) { /* ignore */ }
  }
}

// 각 렌더 단계를 서로 독립시킨다 — 예를 들어 Chart.js CDN이 사내망에서 막혀
// renderTrendChart가 예외를 던지더라도, 카드 렌더링은 계속 진행되어야 한다.
function safeRender(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[render:${name}]`, err);
  }
}

function renderAll(newState) {
  const focusInfo = currentFocusInfo();
  state = newState;

  safeRender('trendChart', () => renderTrendChart(state.historicalSales, state.forecast.months));
  safeRender('monthBoard', () => renderMonthBoard(state.forecast));

  restoreFocus(focusInfo);
}

// ---------------- Networking ----------------

async function fetchState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('불러오기 실패');
  return res.json();
}

async function saveMonthField(ym, field, value) {
  setSyncStatus('saving');
  try {
    const res = await fetch(`/api/month/${ym}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: { [field]: value } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '저장 실패');
    renderAll(data);
    setSyncStatus('ok');
    showToast('저장되었습니다.');
    return true;
  } catch (err) {
    setSyncStatus('error');
    showToast(err.message || '저장 중 오류가 발생했습니다.', true);
    return false;
  }
}

function onFinalGrowthChange(ym, input) {
  const raw = input.value.trim();
  if (raw === '') {
    saveMonthField(ym, 'final_growth', '');
    return;
  }
  const num = parseFloat(raw);
  if (Number.isNaN(num)) { showToast('숫자를 입력해주세요.', true); return; }
  saveMonthField(ym, 'final_growth', num / 100);
}

async function onFreeTextBlur(ym, field, textarea) {
  const value = textarea.value;
  if (value === textarea.dataset.savedValue) return; // 변경 없으면 저장 안 함
  const ok = await saveMonthField(ym, field, value);
  if (ok) textarea.dataset.savedValue = value;
}

async function pollLoop() {
  try {
    const data = await fetchState();
    renderAll(data);
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
  } finally {
    setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

// ---------------- Realtime (Supabase) ----------------
// month_assumptions 변경 감지 시 fetchState()+renderAll()을 다시 호출하는 트리거로만
// 사용 — payload를 직접 해석해서 상태를 재구성하지 않음(forecast 계산은 서버 한 곳에만
// 유지). /api/config에 값이 없으면 폴링에만 의존한다.
async function setupRealtime() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || typeof window.supabase === 'undefined') return;

    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    const scheduleRefetch = () => {
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = setTimeout(async () => {
        try {
          const data = await fetchState();
          renderAll(data);
          setSyncStatus('ok');
        } catch (err) {
          setSyncStatus('error');
        }
      }, 250);
    };

    client
      .channel('forecast-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'month_assumptions' }, scheduleRefetch)
      .subscribe();
  } catch (err) {
    // Realtime 연결 실패해도 폴백 폴링이 있으므로 조용히 무시
  }
}

// ---------------- Init ----------------

(function init() {
  renderExtVarsSection();

  fetchState()
    .then((data) => { renderAll(data); setTimeout(pollLoop, POLL_INTERVAL_MS); })
    .catch((err) => showToast('초기 로딩 실패: ' + err.message, true));

  setupRealtime();
})();

const FORECAST_MONTHS = [
  { ym: '202610', label: '2026-10', priorYear: 2025, priorMonth: 10 },
  { ym: '202611', label: '2026-11', priorYear: 2025, priorMonth: 11 },
  { ym: '202612', label: '2026-12', priorYear: 2025, priorMonth: 12 },
  { ym: '202701', label: '2027-01', priorYear: 2026, priorMonth: 1 },
  { ym: '202702', label: '2027-02', priorYear: 2026, priorMonth: 2 },
  { ym: '202703', label: '2027-03', priorYear: 2026, priorMonth: 3 },
  { ym: '202704', label: '2027-04', priorYear: 2026, priorMonth: 4 },
];

function buildHistMap(historicalRows) {
  const map = {};
  for (const r of historicalRows) map[`${r.year}-${r.month}`] = r.revenue;
  return map;
}

/**
 * @param {object} monthAssumptionsByYm - ym('202610' 등) -> month_assumptions 행
 * @param {Array} historicalRows - historical_sales 전체 행
 * @returns {object} { months: [...], totals: {...} }
 */
function computeForecast(monthAssumptionsByYm, historicalRows) {
  const histMap = buildHistMap(historicalRows);

  const months = FORECAST_MONTHS.map((m) => {
    const priorValue = histMap[`${m.priorYear}-${m.priorMonth}`] ?? 0;
    const a = monthAssumptionsByYm[m.ym] || {};

    const referenceGrowth = a.reference_growth ?? 0;
    const referenceRationale = a.reference_rationale ?? '';
    const storeChange = a.store_change ?? '';
    const newProduct = a.new_product ?? '';

    const isFinal = a.final_growth !== null && a.final_growth !== undefined;
    const finalGrowth = isFinal ? a.final_growth : null;
    const effectiveGrowth = isFinal ? a.final_growth : referenceGrowth;

    // storeChange/newProduct는 참고 정보일 뿐 계산에는 사용하지 않음
    const revenue = priorValue * (1 + effectiveGrowth);

    return {
      ym: m.ym,
      label: m.label,
      priorValue,
      referenceGrowth,
      referenceRationale,
      storeChange,
      newProduct,
      finalGrowth,
      isFinal,
      effectiveGrowth,
      revenue,
    };
  });

  const sum = (arr, pick) => arr.reduce((acc, m) => acc + pick(m), 0);
  const totals = {
    priorTotal: sum(months, (m) => m.priorValue),
    revenueTotal: sum(months, (m) => m.revenue),
    priorOct2Dec: sum(months.slice(0, 3), (m) => m.priorValue),
    revenueOct2Dec: sum(months.slice(0, 3), (m) => m.revenue),
    priorJan2Apr: sum(months.slice(3, 7), (m) => m.priorValue),
    revenueJan2Apr: sum(months.slice(3, 7), (m) => m.revenue),
  };

  return { months, totals };
}

module.exports = { computeForecast, FORECAST_MONTHS };

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const HISTORICAL_SEED = [
  [2025, 1, 867.0, '실적'], [2025, 2, 991.523562, '실적'], [2025, 3, 917.116636, '실적'],
  [2025, 4, 806.678972, '실적'], [2025, 5, 899.132924, '실적'], [2025, 6, 805.300972, '실적'],
  [2025, 7, 903.989653, '실적'], [2025, 8, 856.285886, '실적'], [2025, 9, 905.038069, '실적'],
  [2025, 10, 775.395290, '실적'], [2025, 11, 798.817022, '실적'], [2025, 12, 859.717800, '실적'],
  [2026, 1, 1021.545100, '실적'], [2026, 2, 1048.903200, '실적'], [2026, 3, 1064.448190, '실적'],
  [2026, 4, 863.125600, '실적'], [2026, 5, 888.114200, '실적'], [2026, 6, 834.491400, '실적'],
  [2026, 7, 938.0, '예상'], [2026, 8, 975.0, '예상'], [2026, 9, 989.0, '예상'],
];

// 로직 근거 성장률 시드값 — 이전 growth_YYYYMM 기본값과 산출 근거를 그대로 옮김
// (26.10~12월은 25년 데이터 부재로 26.7~9월 평균 성장률 대체 추정,
//  27.1~4월은 26년 동월 실적 YoY 그대로 준용 — CONTEXT.md 데이터 배경 참고)
const MONTH_ASSUMPTIONS_SEED = [
  { ym: '202610', reference_growth: 0.09, reference_rationale: '26.7-9월 평균 성장률 준용' },
  { ym: '202611', reference_growth: 0.09, reference_rationale: '26.7-9월 평균 성장률 준용' },
  { ym: '202612', reference_growth: 0.09, reference_rationale: '26.7-9월 평균 성장률 준용' },
  { ym: '202701', reference_growth: 0.178, reference_rationale: '26년 1월 YoY 실적 준용' },
  { ym: '202702', reference_growth: 0.058, reference_rationale: '26년 2월 YoY 실적 준용' },
  { ym: '202703', reference_growth: 0.161, reference_rationale: '26년 3월 YoY 실적 준용' },
  { ym: '202704', reference_growth: 0.07, reference_rationale: '26년 4월 YoY 실적 준용' },
];

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 구 시나리오 기반 단일행 assumptions 테이블 폐기 (month_assumptions로 대체)
    await client.query('DROP TABLE IF EXISTS assumptions;');
    // 실시간 협업이라 편집자별 변경 이력을 추적할 필요가 없다는 결론 (2026-07-02) — history 테이블 폐기
    await client.query('DROP TABLE IF EXISTS history;');

    await client.query(`
      CREATE TABLE IF NOT EXISTS historical_sales (
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        revenue DOUBLE PRECISION NOT NULL,
        type TEXT NOT NULL,
        PRIMARY KEY (year, month)
      );

      CREATE TABLE IF NOT EXISTS month_assumptions (
        ym TEXT PRIMARY KEY,
        reference_growth DOUBLE PRECISION,
        reference_rationale TEXT,
        store_change TEXT DEFAULT '',
        new_product TEXT DEFAULT '',
        final_growth DOUBLE PRECISION,
        updated_at TEXT
      );
    `);

    // OEM/ODM 가산 조건 미확정으로 제외 (2026-07-02) — 기존 배포에 컬럼이 이미 있을 수 있어 방어적으로 제거
    await client.query('ALTER TABLE month_assumptions DROP COLUMN IF EXISTS oem_addback;');
    await client.query('ALTER TABLE month_assumptions DROP COLUMN IF EXISTS updated_by;');

    // "영업환경" 자유서술 1칸 → "매장(유통) 변동"/"신제품 출시" 2칸으로 분리 (2026-07-02) —
    // 프로모션은 상시로 도는 거라 기록 의미가 없고, 매장 증감/신제품 출시만 실질적으로 의미있는 변수라는 판단.
    // 기존 배포에 business_context 컬럼이 이미 있을 수 있어 방어적으로 제거하고 새 컬럼을 추가.
    await client.query('ALTER TABLE month_assumptions DROP COLUMN IF EXISTS business_context;');
    await client.query("ALTER TABLE month_assumptions ADD COLUMN IF NOT EXISTS store_change TEXT DEFAULT '';");
    await client.query("ALTER TABLE month_assumptions ADD COLUMN IF NOT EXISTS new_product TEXT DEFAULT '';");

    // ---- 실적 데이터 시드 (업로드 원본 기준, 최초 1회만) ----
    const insertHistSql =
      'INSERT INTO historical_sales (year, month, revenue, type) VALUES ($1, $2, $3, $4) ON CONFLICT (year, month) DO NOTHING';
    for (const row of HISTORICAL_SEED) {
      await client.query(insertHistSql, row);
    }

    // ---- 월별 가정값 기본 시드 (로직 근거 성장률만, 최초 1회만) ----
    const insertMonthSql = `
      INSERT INTO month_assumptions (ym, reference_growth, reference_rationale, store_change, new_product, final_growth, updated_at)
      VALUES ($1, $2, $3, '', '', NULL, $4)
      ON CONFLICT (ym) DO NOTHING
    `;
    const seededAt = new Date().toISOString();
    for (const row of MONTH_ASSUMPTIONS_SEED) {
      await client.query(insertMonthSql, [row.ym, row.reference_growth, row.reference_rationale, seededAt]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };

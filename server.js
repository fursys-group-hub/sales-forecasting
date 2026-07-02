require('dotenv').config();

const express = require('express');
const path = require('path');
const { pool, initDb } = require('./db');
const { computeForecast, FORECAST_MONTHS } = require('./forecast');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VALID_YMS = new Set(FORECAST_MONTHS.map((m) => m.ym));
const MONTH_EDITABLE_FIELDS = ['store_change', 'new_product', 'final_growth'];
const TEXT_FIELDS = new Set(['store_change', 'new_product']);

function numEqual(a, b) {
  const an = a === null || a === undefined ? null : Number(a);
  const bn = b === null || b === undefined ? null : Number(b);
  if (an === null && bn === null) return true;
  if (an === null || bn === null) return false;
  return an === bn;
}

async function getMonthAssumptions() {
  const { rows } = await pool.query('SELECT * FROM month_assumptions ORDER BY ym');
  return rows;
}

async function getHistoricalSales() {
  const { rows } = await pool.query('SELECT year, month, revenue, type FROM historical_sales ORDER BY year, month');
  return rows;
}

function buildForecast(monthAssumptions, historicalSales) {
  const byYm = {};
  for (const row of monthAssumptions) byYm[row.ym] = row;
  return computeForecast(byYm, historicalSales);
}

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL ?? null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null,
  });
});

app.get('/api/state', async (req, res) => {
  const monthAssumptions = await getMonthAssumptions();
  const historicalSales = await getHistoricalSales();
  const forecast = buildForecast(monthAssumptions, historicalSales);
  res.json({ monthAssumptions, historicalSales, forecast });
});

app.put('/api/month/:ym', async (req, res) => {
  const { ym } = req.params;
  if (!VALID_YMS.has(ym)) {
    return res.status(400).json({ error: '잘못된 월입니다.' });
  }

  const { changes } = req.body || {};
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
    return res.status(400).json({ error: '변경할 값이 없습니다.' });
  }

  const client = await pool.connect();
  let changedCount = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM month_assumptions WHERE ym = $1 FOR UPDATE', [ym]);
    const current = rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: '해당 월 데이터를 찾을 수 없습니다.' });
    }

    const setClauses = [];
    const setValues = [];
    const now = new Date().toISOString();

    for (const [field, rawValue] of Object.entries(changes)) {
      if (!MONTH_EDITABLE_FIELDS.includes(field)) continue;
      const isText = TEXT_FIELDS.has(field);

      let value;
      if (isText) {
        value = String(rawValue ?? '');
      } else if (rawValue === null || rawValue === undefined || rawValue === '') {
        value = null;
      } else {
        const num = Number(rawValue);
        if (!Number.isFinite(num)) continue;
        value = num;
      }

      const oldValue = current[field];
      const changed = isText ? oldValue !== value : !numEqual(oldValue, value);
      if (!changed) continue;

      setValues.push(value);
      setClauses.push(`${field} = $${setValues.length}`);
      changedCount++;
    }

    if (changedCount > 0) {
      setValues.push(now);
      setClauses.push(`updated_at = $${setValues.length}`);
      setValues.push(ym);
      await client.query(
        `UPDATE month_assumptions SET ${setClauses.join(', ')} WHERE ym = $${setValues.length}`,
        setValues
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const monthAssumptions = await getMonthAssumptions();
  const historicalSales = await getHistoricalSales();
  const forecast = buildForecast(monthAssumptions, historicalSales);
  res.json({ monthAssumptions, historicalSales, forecast, changedCount });
});

const PORT = process.env.PORT || 4747;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`슬로우베드 매출예측 협업 툴 실행 중: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB 초기화 실패:', err);
    process.exit(1);
  });

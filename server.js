require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');

const { queryBotDB, queryBusinessDB } = require('./db');
const { initDB } = require('./dbInit');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ========= helpers ========= */
const norm = s => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'');

const parseTriggers = v => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
};

/* ========= init ========= */
initDB().catch(err => {
  console.error('DB init error:', err.message);
});

async function ensureBotConfig(bot_id = 'default') {
  const rows = await queryBotDB(
    'SELECT bot_id, mode, rules FROM bot_configs WHERE bot_id=$1',
    [bot_id]
  );
  if (rows.length === 0) {
    await queryBotDB(
      'INSERT INTO bot_configs (bot_id, mode, rules) VALUES ($1,$2,$3)',
      [bot_id, 'sales', JSON.stringify({})]
    );
    return { bot_id, mode: 'sales', rules: {} };
  }
  return rows[0];
}

/* ========= health ========= */
app.get('/health', (_req, res) => res.json({ ok: true }));

/* ======================
   REGLAS
====================== */
app.get('/api/rules', async (req, res) => {
  try {
    const mode = req.query.mode;
    const sql = mode
      ? 'SELECT * FROM business_rules WHERE mode=$1 ORDER BY priority DESC, id DESC'
      : 'SELECT * FROM business_rules ORDER BY priority DESC, id DESC';
    const params = mode ? [mode] : [];
    const rows = await queryBusinessDB(sql, params);
    res.json(rows); // tus frontends esperan array crudo
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rules', async (req, res) => {
  try {
    const { mode, condition, triggers, action, priority } = req.body;
    await queryBusinessDB(
      'INSERT INTO business_rules (mode, condition, triggers, action, priority) VALUES ($1,$2,$3,$4,$5)',
      [mode, condition, JSON.stringify(triggers || []), action, priority || 50]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { mode, condition, triggers, action, priority } = req.body;
    await queryBusinessDB(
      'UPDATE business_rules SET mode=$1, condition=$2, triggers=$3, action=$4, priority=$5 WHERE id=$6',
      [mode, condition, JSON.stringify(triggers || []), action, priority || 50, id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await queryBusinessDB('DELETE FROM business_rules WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rules/restore-defaults', async (_req, res) => {
  try {
    await queryBusinessDB('DELETE FROM business_rules', []);
    const js = JSON.parse(require('fs').readFileSync('./rules.json', 'utf8'));
    const insert =
      'INSERT INTO business_rules (mode, condition, triggers, action, priority) VALUES ($1,$2,$3,$4,$5)';
    for (const group of ['common', 'sales', 'reservations']) {
      if (!js[group]) continue;
      for (const r of js[group]) {
        await queryBusinessDB(insert, [
          r.mode,
          r.condition,
          JSON.stringify(r.triggers || []),
          r.action,
          r.priority || 50,
        ]);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================
   PRODUCTOS
====================== */
app.get('/api/products', async (_req, res) => {
  try {
    const rows = await queryBusinessDB(
      'SELECT * FROM products ORDER BY id DESC',
      []
    );
    res.json(rows); // tu products.html espera array crudo
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, price, stock } = req.body;
    await queryBusinessDB(
      'INSERT INTO products (name, price, stock) VALUES ($1,$2,$3)',
      [name, price, stock]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================
   RESERVAS
====================== */
app.get('/api/appointments', async (_req, res) => {
  try {
    const rows = await queryBusinessDB(
      'SELECT * FROM appointments ORDER BY starts_at DESC',
      []
    );
    res.json(rows); // tu reservations.html espera array crudo
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const { customer, starts_at, notes } = req.body;
    await queryBusinessDB(
      'INSERT INTO appointments (customer, starts_at, notes) VALUES ($1,$2,$3)',
      [customer, starts_at, notes]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================
   CONFIG
====================== */
app.get('/api/config', async (req, res) => {
  try {
    const bot_id = req.query.bot_id || 'default';
    const cfg = await ensureBotConfig(bot_id);
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const { bot_id = 'default', mode, rules } = req.body || {};
    const current = await ensureBotConfig(bot_id);
    const newMode = mode || current.mode;
    const newRules = rules ?? current.rules;
    await queryBotDB(
      'UPDATE bot_configs SET mode=$2, rules=$3 WHERE bot_id=$1',
      [bot_id, newMode, newRules]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ======================
   CHAT
====================== */
app.post('/api/chat', async (req, res) => {
  try {
    const { message = '', bot_id } = req.body || {};
    const cfg = await ensureBotConfig(bot_id);

    const rules = await queryBusinessDB(
      'SELECT * FROM business_rules WHERE mode=$1 OR mode=$2 ORDER BY priority DESC',
      [cfg.mode, 'common']
    );

    const msg = norm(message);
    let matched = null;
    for (const r of rules) {
      const triggers = parseTriggers(r.triggers);
      for (const t of triggers) {
        if (msg.includes(norm(String(t)))) { matched = r; break; }
      }
      if (matched) break;
    }

    if (matched) {
      return res.json({ ok: true, reply: matched.action });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        ok: true,
        reply: 'No encontré una regla para eso. Podés reformular o crear una regla nueva.'
      });
    }

    const prompt =
      `Actúa como bot del negocio. Prioriza estas reglas (JSON): ${JSON.stringify(rules)}.\n` +
      `Usuario: "${message}". Responde breve en español.`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const reply = response.data?.choices?.[0]?.message?.content
      || 'No entendí, ¿podés reformular?';

    res.json({ ok: true, reply });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

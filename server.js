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

// inicializar DBs y tablas
initDB().catch(err => {
  console.error('DB init error:', err.message);
});

// asegurar config inicial del bot
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

/* ======================
   ENDPOINTS REGLAS
====================== */
app.get('/api/rules', async (req, res) => {
  try {
    const mode = req.query.mode;
    let rows;
    if (mode) {
      rows = await queryBusinessDB(
        'SELECT * FROM business_rules WHERE mode=$1 ORDER BY priority DESC, id DESC',
        [mode]
      );
    } else {
      rows = await queryBusinessDB(
        'SELECT * FROM business_rules ORDER BY priority DESC, id DESC',
        []
      );
    }
    res.json(rows);
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
      [
        mode,
        condition,
        JSON.stringify(triggers || []),
        action,
        priority || 50,
        id,
      ]
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

app.post('/api/rules/restore-defaults', async (req, res) => {
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
          JSON.stringify(r.triggers),
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
   ENDPOINTS PRODUCTOS
====================== */
app.get('/api/products', async (req, res) => {
  try {
    const rows = await queryBusinessDB('SELECT * FROM products ORDER BY id DESC', []);
    res.json(rows);
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
   ENDPOINTS RESERVAS
====================== */
app.get('/api/appointments', async (req, res) => {
  try {
    const rows = await queryBusinessDB(
      'SELECT * FROM appointments ORDER BY starts_at DESC',
      []
    );
    res.json(rows);
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
   CHAT DEL BOT
====================== */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, bot_id } = req.body;
    const cfg = await ensureBotConfig(bot_id);

    // buscar reglas primero
    const rules = await queryBusinessDB(
      'SELECT * FROM business_rules WHERE mode=$1 OR mode=$2 ORDER BY priority DESC',
      [cfg.mode, 'common']
    );

    let matched = null;
    for (const r of rules) {
      const triggers = r.triggers || [];
      for (const t of triggers) {
        if (message.toLowerCase().includes(t.toLowerCase())) {
          matched = r;
          break;
        }
      }
      if (matched) break;
    }

    if (matched) {
      return res.json({ reply: matched.action });
    }

    // fallback a OpenAI
    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        reply:
          'Lo siento, no entiendo tu consulta y no hay API configurada para responder.',
      });
    }

    const prompt = `Eres un asistente que responde en base a las reglas de negocio: ${JSON.stringify(
      rules
    )}. Usuario: ${message}`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const reply =
      response.data.choices[0].message?.content ||
      'No entendí, podrías reformularlo?';

    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================
   SERVER START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

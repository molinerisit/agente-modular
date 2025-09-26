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

// servir todo desde public
app.use(express.static(path.join(__dirname, 'public')));

// inicializar DBs y tablas
initDB().catch(err => console.error('DB init error:', err.message));

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
    res.json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    res.json([]); // siempre devolver array para frontend
  }
});

/* ======================
   ENDPOINTS PRODUCTOS
====================== */
app.get('/api/products', async (req, res) => {
  try {
    const rows = await queryBusinessDB('SELECT * FROM products ORDER BY id DESC', []);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    res.json([]);
  }
});

/* ======================
   CHAT DEL BOT
====================== */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, bot_id } = req.body;
    const cfg = await ensureBotConfig(bot_id);

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

    if (matched) return res.json({ reply: matched.action });

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
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const reply =
      response.data.choices[0].message?.content ||
      'No entendí, podrías reformularlo?';

    res.json({ reply });
  } catch (e) {
    res.json({ reply: 'Error procesando la solicitud' });
  }
});

/* ======================
   SERVER START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

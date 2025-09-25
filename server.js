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

// initialize DBs on startup
initDB().catch(err=>{
  console.error('Failed initializing DBs:', err.message);
});

// helper
async function ensureBotConfig(bot_id='default'){
  const rows = await queryBotDB('SELECT bot_id, mode, rules FROM bot_configs WHERE bot_id=$1', [bot_id]);
  if(rows.length === 0){
    await queryBotDB('INSERT INTO bot_configs (bot_id, mode, rules) VALUES ($1,$2,$3)', [bot_id, 'sales', JSON.stringify({})]);
    return { bot_id, mode: 'sales', rules: {} };
  }
  return rows[0];
}

// endpoints
app.get('/api/config', async (req,res)=>{
  try {
    const bot_id = req.query.bot_id || 'default';
    const cfg = await ensureBotConfig(bot_id);
    const brules = await queryBusinessDB('SELECT * FROM business_rules ORDER BY id DESC', []);
    res.json({ ok:true, config: cfg, business_rules: brules });
  } catch(e){ res.status(500).json({ ok:false, error: e.message }); }
});

app.post('/api/config', async (req,res)=>{
  try {
    const { bot_id='default', mode, rules } = req.body;
    await queryBotDB('INSERT INTO bot_configs (bot_id, mode, rules) VALUES ($1,$2,$3) ON CONFLICT (bot_id) DO UPDATE SET mode=EXCLUDED.mode, rules=EXCLUDED.rules', [bot_id, mode, JSON.stringify(rules || {})]);
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ ok:false, error: e.message }); }
});

// products
app.get('/api/products', async (req,res)=>{
  try{ const rows = await queryBusinessDB('SELECT * FROM products ORDER BY id DESC', []); res.json(rows); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/products', async (req,res)=>{
  const { name, price, stock, meta } = req.body;
  try{
    await queryBusinessDB('INSERT INTO products (name,price,stock,meta) VALUES ($1,$2,$3,$4)', [name, price, stock, meta || {}]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.delete('/api/products/:id', async (req,res)=>{
  try{ await queryBusinessDB('DELETE FROM products WHERE id=$1', [req.params.id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); }
});

// appointments
app.get('/api/appointments', async (req,res)=>{
  try{ const rows = await queryBusinessDB('SELECT * FROM appointments ORDER BY starts_at ASC LIMIT 100', []); res.json(rows); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/appointments', async (req,res)=>{
  const { customer, starts_at, notes } = req.body;
  try{
    await queryBusinessDB('INSERT INTO appointments (customer, starts_at, notes) VALUES ($1,$2,$3)', [customer, starts_at || null, notes || null]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.delete('/api/appointments/:id', async (req,res)=>{
  try{ await queryBusinessDB('DELETE FROM appointments WHERE id=$1', [req.params.id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); }
});

// business_rules
app.get('/api/business_rules', async (req,res)=>{
  try{ const rows = await queryBusinessDB('SELECT * FROM business_rules ORDER BY id DESC', []); res.json(rows); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/business_rules', async (req,res)=>{
  const { key, value } = req.body;
  try{
    await queryBusinessDB('INSERT INTO business_rules (key, value) VALUES ($1,$2)', [key, value]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.delete('/api/business_rules/:id', async (req,res)=>{
  try{ await queryBusinessDB('DELETE FROM business_rules WHERE id=$1', [req.params.id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); }
});

// chat
app.post('/api/chat', async (req,res)=>{
  const { bot_id='default', message } = req.body;
  if(!message) return res.status(400).json({ ok:false, error:'message required' });
  try{
    const cfg = await ensureBotConfig(bot_id);
    const mode = cfg.mode || 'sales';
    const rules = cfg.rules || {};
    let context = '';
    if(mode === 'sales'){
      const prods = await queryBusinessDB('SELECT id,name,price,stock FROM products ORDER BY id DESC LIMIT 10', []);
      if(prods.length){
        context += 'Productos:\n' + prods.map(p=>`- ${p.name} | $${p.price} | stock:${p.stock}`).join('\n') + '\n';
      } else context += 'No hay productos cargados.\n';
    } else {
      const appts = await queryBusinessDB('SELECT id,customer,starts_at,notes FROM appointments ORDER BY starts_at LIMIT 10', []);
      if(appts.length){
        context += 'Reservas:\n' + appts.map(a=>`- ${a.customer} | ${a.starts_at} | ${a.notes||''}`).join('\n') + '\n';
      } else context += 'No hay reservas.\n';
    }
    const brules = await queryBusinessDB('SELECT key,value FROM business_rules ORDER BY id DESC LIMIT 50', []);
    if(brules.length){
      context += 'Reglas de negocio:\n' + brules.map(r=>`- ${r.key}: ${r.value}`).join('\n') + '\n';
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    let assistant = 'Lo siento, OpenAI API key no configurada en servidor.';
    if(OPENAI_KEY){
      const systemPrompt = mode === 'sales' ? 'Eres un agente de ventas. Usa SOLO la información provista.' : 'Eres un secretario que agenda citas. Usa SOLO la información provista.';
      const userPrompt = `Contexto:\n${context}\nReglas (bot): ${JSON.stringify(rules)}\nUsuario: ${message}\nRespuesta:`;
      const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages:[
          { role:'system', content: systemPrompt },
          { role:'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.2
      }, { headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type':'application/json' }});
      assistant = (resp.data.choices && resp.data.choices[0].message && resp.data.choices[0].message.content) || 'Error generando respuesta.';
    }

    res.json({ ok:true, reply: assistant });
  } catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server running on port', PORT));
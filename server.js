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

initDB().catch(err=>{
  console.error('DB init error:', err.message);
});

async function ensureBotConfig(bot_id='default'){
  const rows = await queryBotDB('SELECT bot_id, mode, rules FROM bot_configs WHERE bot_id=$1', [bot_id]);
  if(rows.length === 0){
    await queryBotDB('INSERT INTO bot_configs (bot_id, mode, rules) VALUES ($1,$2,$3)', [bot_id, 'sales', JSON.stringify({})]);
    return { bot_id, mode: 'sales', rules: {} };
  }
  return rows[0];
}

// rules endpoints
app.get('/api/rules', async (req,res)=>{
  try{
    const mode = req.query.mode;
    let rows;
    if(mode){
      rows = await queryBusinessDB('SELECT * FROM business_rules WHERE mode=$1 ORDER BY priority DESC, id DESC', [mode]);
    } else {
      rows = await queryBusinessDB('SELECT * FROM business_rules ORDER BY priority DESC, id DESC', []);
    }
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/rules', async (req,res)=>{
  try{
    const { mode, condition, triggers, action, priority } = req.body;
    await queryBusinessDB('INSERT INTO business_rules (mode, condition, triggers, action, priority) VALUES ($1,$2,$3,$4,$5)', [mode, condition, JSON.stringify(triggers || []), action, priority || 50]);
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.put('/api/rules/:id', async (req,res)=>{
  try{
    const id = req.params.id;
    const { mode, condition, triggers, action, priority } = req.body;
    await queryBusinessDB('UPDATE business_rules SET mode=$1, condition=$2, triggers=$3, action=$4, priority=$5 WHERE id=$6', [mode, condition, JSON.stringify(triggers || []), action, priority || 50, id]);
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.delete('/api/rules/:id', async (req,res)=>{
  try{ const id = req.params.id; await queryBusinessDB('DELETE FROM business_rules WHERE id=$1', [id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/rules/restore-defaults', async (req,res)=>{
  try{
    await queryBusinessDB('DELETE FROM business_rules', []);
    const js = JSON.parse(require('fs').readFileSync('./rules.json','utf8'));
    const insert = 'INSERT INTO business_rules (mode, condition, triggers, action, priority) VALUES ($1,$2,$3,$4,$5)';
    for(const group of ['common','sales','reservations']){
      if(!js[group]) continue;
      for(const r of js[group]){
        await queryBusinessDB(insert, [r.mode, r.condition, JSON.stringify(r.triggers), r.action, r.priority || 50]);
      }
    }
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

# products endpoints
app.get('/api/products', async (req,res)=>{ try{ const rows = await queryBusinessDB('SELECT * FROM products ORDER BY id DESC', []); res.json(rows); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/products', async (req,res)=>{ const { name, price, stock, meta } = req.body; try{ await queryBusinessDB('INSERT INTO products (name,price,stock,meta) VALUES ($1,$2,$3,$4)', [name, price, stock, meta || {}]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); } });
app.delete('/api/products/:id', async (req,res)=>{ try{ await queryBusinessDB('DELETE FROM products WHERE id=$1', [req.params.id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); } });

# appointments endpoints
app.get('/api/appointments', async (req,res)=>{ try{ const rows = await queryBusinessDB('SELECT * FROM appointments ORDER BY starts_at ASC LIMIT 200', []); res.json(rows); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/appointments', async (req,res)=>{ const { customer, starts_at, notes } = req.body; try{ await queryBusinessDB('INSERT INTO appointments (customer, starts_at, notes) VALUES ($1,$2,$3)', [customer, starts_at || null, notes || null]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); } });
app.delete('/api/appointments/:id', async (req,res)=>{ try{ await queryBusinessDB('DELETE FROM appointments WHERE id=$1', [req.params.id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: e.message }); } });

# config endpoints
app.get('/api/config', async (req,res)=>{ try{ const bot_id = req.query.bot_id || 'default'; const cfg = await ensureBotConfig(bot_id); res.json({ ok:true, config: cfg }); } catch(e){ res.status(500).json({ ok:false, error: e.message }); } });
app.post('/api/config', async (req,res)=>{ try{ const { bot_id='default', mode, rules } = req.body; await queryBotDB('INSERT INTO bot_configs (bot_id, mode, rules) VALUES ($1,$2,$3) ON CONFLICT (bot_id) DO UPDATE SET mode=EXCLUDED.mode, rules=EXCLUDED.rules', [bot_id, mode, JSON.stringify(rules || {})]); res.json({ ok:true }); } catch(e){ res.status(500).json({ ok:false, error: e.message }); } });

# rule engine and chat
async function evaluateRules(bot_id, message){
  const cfg = await ensureBotConfig(bot_id);
  const mode = cfg.mode || 'sales';
  const common = await queryBusinessDB('SELECT * FROM business_rules WHERE mode=$1 ORDER BY priority DESC', ['common']).catch(()=>[]);
  const modeRules = await queryBusinessDB('SELECT * FROM business_rules WHERE mode=$1 ORDER BY priority DESC', [mode]).catch(()=>[]);
  const all = (common||[]).concat(modeRules||[]);
  const text = (message||'').toLowerCase();
  for(const r of all){
    try{
      const triggers = Array.isArray(r.triggers) ? r.triggers : JSON.parse(r.triggers || '[]');
      for(const t of triggers){
        const tok = (''+t).toLowerCase();
        if(!tok) continue;
        if(text.includes(tok)){
          return { matched: true, rule: r };
        }
      }
    }catch(e){ continue; }
  }
  return { matched:false };
}

app.post('/api/chat', async (req,res)=>{
  const { bot_id='default', message } = req.body;
  if(!message) return res.status(400).json({ ok:false, error:'message required' });
  try{
    const evalRes = await evaluateRules(bot_id, message);
    if(evalRes.matched){
      const r = evalRes.rule;
      let filled = r.action || '';
      // fill placeholders from simple business settings stored as business_rules with mode='common' and key in condition
      const settingsRows = await queryBusinessDB("SELECT condition, action FROM business_rules WHERE mode='common'", []).catch(()=>[]);
      const settings = {};
      for(const s of settingsRows){
        // if condition looks like a key:value store (we'll support some specific conditions like 'address_setting' in condition)
        // but in general users can create rules with action text that include static info; we'll still replace common placeholders if present
        // check if condition equals a known config key like 'address_setting'
        settings[s.condition] = s.action;
      }
      filled = filled.replace(/{address}/g, settings.address_setting || settings.address || '—');
      filled = filled.replace(/{hours}/g, settings.hours_setting || settings.hours || '—');
      filled = filled.replace(/{phone}/g, settings.phone_setting || settings.phone || '—');
      filled = filled.replace(/{payment_methods}/g, settings.payment_methods || 'efectivo y tarjetas');
      filled = filled.replace(/{cash_discount}/g, settings.cash_discount || '10%');
      // product specific replacements
      if(filled.includes('{product_name}') || filled.includes('{price}') || filled.includes('{stock}')){
        const prods = await queryBusinessDB('SELECT id,name,price,stock FROM products', []);
        let found = null;
        for(const p of prods){
          if(message.toLowerCase().includes((p.name||'').toLowerCase())){ found = p; break; }
        }
        if(found){
          filled = filled.replace(/{product_name}/g, found.name);
          filled = filled.replace(/{price}/g, ''+found.price);
          filled = filled.replace(/{stock}/g, ''+found.stock);
        } else {
          filled = filled.replace(/{product_name}/g, 'el producto');
          filled = filled.replace(/{price}/g, '—');
          filled = filled.replace(/{stock}/g, '0');
        }
      }
      return res.json({ ok:true, reply: filled, rule: evalRes.rule });
    }

    // fallback to OpenAI
    const cfg = await ensureBotConfig(bot_id);
    const mode = cfg.mode || 'sales';
    const rulesList = await queryBusinessDB('SELECT mode,condition,action FROM business_rules WHERE mode IN ($1,$2) ORDER BY priority DESC LIMIT 50', ['common', mode]);
    let rulesText = rulesList.map(r=>`- [${r.mode}] ${r.condition}: ${r.action}`).join("\n");
    const prods = await queryBusinessDB('SELECT name,price,stock FROM products ORDER BY id DESC LIMIT 10', []);
    let prodText = prods.map(p=>`- ${p.name} | $${p.price} | stock:${p.stock}`).join('\n');
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    let assistant = 'Lo siento, OpenAI API key no configurada.';
    if(OPENAI_KEY){
      const systemPrompt = mode === 'sales' ? 'Eres un agente de ventas. Usa SOLO la información provista.' : 'Eres un secretario que agenda citas. Usa SOLO la información provista.';
      const userPrompt = `Reglas del negocio:\n${rulesText}\nProductos:\n${prodText}\nUsuario: ${message}\nRespuesta:`;
      const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages:[ { role:'system', content: systemPrompt }, { role:'user', content: userPrompt } ],
        max_tokens: 500,
        temperature: 0.2
      }, { headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type':'application/json' } });
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

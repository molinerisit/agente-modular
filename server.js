require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { queryBotDB, queryBusinessDB } = require('./db');
const { initDB } = require('./dbInit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

const PORT = process.env.PORT || 3000;

/* ---------- Utils ---------- */
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}+/gu,''); }
function fillTemplate(tpl, ctx){
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}
function parseTriggers(v){
  if(!v) return [];
  if(Array.isArray(v)) return v;
  try{ return JSON.parse(v); }catch{ return []; }
}
function tokenize(str){
  return norm(str).split(/[^a-z0-9]+/).filter(t=>t.length>2);
}
function jaccard(a, b){
  const A = new Set(a); const B = new Set(b);
  const inter = new Set([...A].filter(x=>B.has(x))).size;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}
function semanticRuleFallback(message, rules){
  const msgTok = tokenize(message);
  let best = null;
  for(const r of rules){
    const triggers = parseTriggers(r.triggers);
    for(const t of triggers){
      const sc = jaccard(msgTok, tokenize(String(t)));
      if(sc >= 0.34){ // umbral conservador
        if(!best || sc > best.score) best = { rule:r, score: sc };
      }
    }
  }
  return best ? best.rule : null;
}


async function ensureBotConfig(bot_id='default'){
  const rows = await queryBotDB('SELECT * FROM bot_configs WHERE bot_id=$1', [bot_id]);
  if(rows.length) return rows[0];
  await queryBotDB('INSERT INTO bot_configs(bot_id,mode) VALUES($1,$2)', [bot_id, 'sales']);
  return (await queryBotDB('SELECT * FROM bot_configs WHERE bot_id=$1', [bot_id]))[0];
}
async function getBusinessProfile(bot_id='default'){
  const [cfg] = await queryBotDB('SELECT * FROM bot_configs WHERE bot_id=$1', [bot_id]);
  return cfg || {};
}
async function findProductLike(message){
  const msg = norm(message);
  const prods = await queryBusinessDB('SELECT * FROM products ORDER BY id DESC', []);
  let best = null;
  for(const p of prods){
    const name = norm(p.name||'');
    if(!name) continue;
    if(msg.includes(name) || name.split(' ').some(tok=> tok.length>2 && msg.includes(tok))){
      if(!best || (p.name||'').length > (best.name||'').length) best = p;
    }
  }
  return best;
}
async function intentNLU(message, mode){
  if(!process.env.OPENAI_API_KEY) return { intent:'unknown', slots:{} };
  const sys = `Eres un clasificador. Devuelve JSON con {intent, slots}.
Intents permitidos (sales): ["ask_price","ask_stock","greet","bye","ask_hours","ask_address","ask_payments"].
Intents permitidos (reservations): ["create_booking","check_availability","cancel_booking","greet","bye","ask_hours","ask_address"].
Slots permitidos: product_name, date_time, customer, service.
No inventes datos.`;
  const user = `Texto: "${message}". Modo: "${mode}". Responde SOLO JSON.`;
  const r = await axios.post('https://api.openai.com/v1/chat/completions',{
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [{role:'system',content:sys},{role:'user',content:user}]
  },{ headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` } });
  try{ return JSON.parse(r.data.choices[0].message.content); }catch{ return {intent:'unknown', slots:{}};}
}

/* ---------- Startup: ensure tables ---------- */
initDB().catch(err=>{ console.error('DB init error', err); process.exit(1); });

/* ---------- Config ---------- */
app.get('/api/config', async (req,res)=>{
  try{
    const bot_id = req.query.bot_id || 'default';
    const cfg = await ensureBotConfig(bot_id);
    res.json({ ok:true, config: cfg });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/config', async (req,res)=>{
  try{
    const { bot_id='default', ...patch } = req.body || {};
    await ensureBotConfig(bot_id);
    const keys = Object.keys(patch);
    if(keys.length){
      const sets = keys.map((k,i)=> `${k}=$${i+2}`).join(', ');
      const vals = keys.map(k=> patch[k]);
      await queryBotDB(`UPDATE bot_configs SET ${sets} WHERE bot_id=$1`, [bot_id, ...vals]);
    }
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------- Rules CRUD ---------- */
app.get('/api/rules', async (req,res)=>{
  try{
    const mode = req.query.mode;
    const rows = await queryBusinessDB(
      mode ? 'SELECT * FROM business_rules WHERE mode=$1 ORDER BY priority DESC' : 'SELECT * FROM business_rules ORDER BY priority DESC',
      mode ? [mode] : []
    );
    res.json(rows);
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.post('/api/rules', async (req,res)=>{
  try{
    const { mode, condition, triggers=[], action, priority=50 } = req.body || {};
    await queryBusinessDB(
      'INSERT INTO business_rules(mode,condition,triggers,action,priority) VALUES($1,$2,$3,$4,$5)',
      [mode, condition, JSON.stringify(triggers), action, priority]
    );
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.put('/api/rules/:id', async (req,res)=>{
  try{
    const id = req.params.id;
    const { mode, condition, triggers=[], action, priority=50 } = req.body || {};
    await queryBusinessDB(
      'UPDATE business_rules SET mode=$2, condition=$3, triggers=$4, action=$5, priority=$6 WHERE id=$1',
      [id, mode, condition, JSON.stringify(triggers), action, priority]
    );
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.delete('/api/rules/:id', async (req,res)=>{
  try{
    const id = req.params.id;
    await queryBusinessDB('DELETE FROM business_rules WHERE id=$1',[id]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/rules/restore-defaults', async (_req,res)=>{
  try{
    await queryBusinessDB('DELETE FROM business_rules', []);
    const fs = require('fs');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname,'rules.json'),'utf-8'));
    const all = [...(defaults.common||[]), ...(defaults.sales||[]), ...(defaults.reservations||[])];
    for(const r of all){
      await queryBusinessDB(
        'INSERT INTO business_rules(mode,condition,triggers,action,priority) VALUES($1,$2,$3,$4,$5)',
        [r.mode, r.condition, JSON.stringify(r.triggers||[]), r.action, r.priority||50]
      );
    }
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------- Products ---------- */
app.get('/api/products', async (_req,res)=>{
  try{
    const rows = await queryBusinessDB('SELECT * FROM products ORDER BY id DESC', []);
    res.json(rows);
  }catch(e){ res.status(500).json({ error:e.message }); }
});
app.post('/api/products', async (req,res)=>{
  try{
    const { name, price, stock } = req.body || {};
    await queryBusinessDB('INSERT INTO products(name,price,stock) VALUES($1,$2,$3)', [name, price, stock]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------- Appointments ---------- */
app.get('/api/appointments', async (_req,res)=>{
  try{
    const rows = await queryBusinessDB('SELECT * FROM appointments ORDER BY starts_at DESC', []);
    res.json(rows);
  }catch(e){ res.status(500).json({ error:e.message }); }
});
app.get('/api/appointments/available', async (req,res)=>{
  try{
    const dt = req.query.starts_at;
    const clash = await queryBusinessDB('SELECT id FROM appointments WHERE starts_at=$1 LIMIT 1',[dt]);
    res.json({ ok:true, available: clash.length===0 });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/appointments', async (req,res)=>{
  try{
    const { customer, starts_at, notes } = req.body || {};
    const clash = await queryBusinessDB('SELECT id FROM appointments WHERE starts_at=$1 LIMIT 1',[starts_at]);
    if(clash.length){ return res.status(409).json({ ok:false, error:'Horario no disponible' }); }
    await queryBusinessDB('INSERT INTO appointments(customer,starts_at,notes) VALUES($1,$2,$3)', [customer, starts_at, notes]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------- Chat ---------- */
app.post('/api/chat', async (req,res)=>{
  try{
    const { message = '', bot_id='default' } = req.body || {};
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

    if(!matched){ matched = semanticRuleFallback(message, rules); }

    const profile = await getBusinessProfile(bot_id);
    const ctxBase = {
      name: profile.name,
      address: profile.address,
      hours: profile.hours,
      phone: profile.phone,
      payment_methods: profile.payment_methods,
      cash_discount: profile.cash_discount,
      service_list: profile.service_list,
      cancellation_policy: profile.cancellation_policy,
      date_time: '' // placeholder común
    };

    if(matched){
      let ctx = { ...ctxBase };
      if(/\{product_name\}|\{price\}|\{stock\}/.test(matched.action)){
        const p = await findProductLike(message);
        if(p){ ctx.product_name = p.name; ctx.price = p.price; ctx.stock = p.stock; }
      }
      return res.json({ ok:true, reply: fillTemplate(matched.action, ctx) });
    }

    if(!process.env.OPENAI_API_KEY){
      let reply;
      if(cfg.mode==='sales'){
        try{ const names = await getProductCatalog(20); reply = names.length ? ('Vendemos: ' + names.join(', ') + '. Decime cuál te interesa.') : 'No tengo productos cargados.'; } catch{ reply = 'Decime qué producto buscás y te confirmo.'; }
      } else {
        reply = (profile.service_list ? ('Servicios: ' + profile.service_list + '. ') : '') + 'Decime día y hora y verifico disponibilidad.';
      }
      return res.json({ ok:true, reply });
    }

    // NLU acotado -> decisión -> respuesta grounded
    const { intent, slots } = await intentNLU(message, cfg.mode);
    let reply = 'No encontré una regla para eso. ¿Podés reformular?';

    if(cfg.mode === 'sales'){
      if(intent === 'ask_catalog'){
        const names = await getProductCatalog(20);
        if(names.length){
          reply = 'Vendemos: ' + names.join(', ') + '. Decime cuál te interesa.';
        } else {
          reply = 'Aún no hay productos cargados.';
        }
      } else 
      if(intent === 'ask_price' || intent === 'ask_stock'){
        const explicit = slots.product_name;
        let p = null;
        if(explicit){
          const r = await queryBusinessDB('SELECT * FROM products WHERE LOWER(name)=LOWER($1) LIMIT 1',[explicit]);
          p = r[0];
        }
        if(!p) p = await findProductLike(message);
        if(p){
          reply = `Tenemos ${p.name}. Precio $${p.price}. Stock ${p.stock}.`;
        }else{
          const names = await getProductCatalog(20);
          reply = names.length ? ('No pasa nada. Algunos productos: ' + names.join(', ') + '. Decime cuál te interesa.') : 'No tengo productos cargados.';
        }
      } else if(intent === 'ask_hours'){
        reply = profile.hours ? `Nuestro horario es: ${profile.hours}.` : 'No tengo horario configurado.';
      } else if(intent === 'ask_address'){
        reply = profile.address ? `Estamos en ${profile.address}.` : 'No tengo dirección configurada.';
      } else if(intent === 'ask_payments'){
        reply = profile.payment_methods ? `Medios de pago: ${profile.payment_methods}.` : 'No tengo medios de pago configurados.';
      }
    } else if(cfg.mode === 'reservations'){
      if(intent === 'ask_services'){
        reply = profile.service_list ? ('Servicios: ' + profile.service_list + '.') : 'No tengo servicios configurados.';
      } else 
      if(intent === 'check_availability' || intent === 'create_booking'){
        const dt = slots.date_time;
        if(!dt){
          reply = `Decime día y hora. Horarios: ${profile.hours||'no configurado'}.`;
        }else{
          const clash = await queryBusinessDB('SELECT id FROM appointments WHERE starts_at=$1 LIMIT 1',[dt]);
          if(clash.length){
            reply = 'Ese horario no está disponible. ¿Querés que te proponga alternativas?';
          }else if(intent === 'create_booking'){
            await queryBusinessDB('INSERT INTO appointments(customer,starts_at,notes) VALUES($1,$2,$3)', [slots.customer||'Cliente', dt, slots.service||null]);
            reply = `Listo. Turno para ${slots.customer||'cliente'} el ${dt}.`;
          }else{
            reply = 'Hay disponibilidad. ¿Querés confirmar el turno?';
          }
        }
      } else if(intent === 'cancel_booking'){
        reply = `Tu turno fue cancelado. Política: ${profile.cancellation_policy||'no configurada'}.`;
      } else if(intent === 'ask_hours'){
        reply = profile.hours ? `Atendemos: ${profile.hours}.` : 'No tengo horario configurado.';
      } else if(intent === 'ask_address'){
        reply = profile.address ? `Estamos en ${profile.address}.` : 'No tengo dirección configurada.';
      }
    }
    /* UNCERTAINTY FALLBACK */
        if(/no estoy seguro|no se como se llama|no sé como se llama|no estoy segur/.test(norm(message))){
          const names = await getProductCatalog(20);
          if(names.length){
            reply = 'Algunos productos: ' + names.join(', ') + '. Decime cuál te interesa.';
          } else {
            reply = 'Aún no hay productos cargados.';
          }
        }
        if(intent === 'greet') reply = 'Hola, ¿en qué puedo ayudarte?';
    if(intent === 'bye') reply = 'Gracias por tu visita.';

    res.json({ ok:true, reply });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.listen(PORT, ()=>{
  console.log(`Server on :${PORT}`);
});

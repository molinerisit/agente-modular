
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const axios = require('axios');
const { DateTime } = require('luxon');
const { z } = require('zod');
const RATE = require('express-rate-limit');
const { queryBotDB, queryBusinessDB } = require('./db');
const { initDB } = require('./dbInit');
const app = express();
app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { "script-src": ["'self'"], "connect-src": ["'self'"], "img-src": ["'self'","data:"], "style-src": ["'self'"], "object-src": ["'none'"] } } }));
app.use(cors({ origin: true }));
app.use(express.json({ limit:'512kb' }));
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname,'public')));
app.use('/api/', RATE({ windowMs: 60_000, max: 180 }));
const PORT = process.env.PORT || 3000;
/* Utils */
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]+/g,''); }
function fillTemplate(tpl, ctx){ return String(tpl).replace(/\{([a-z_]+)\}/gi, (_, k) => { const v = ctx[k]; return v === undefined || v === null ? `{${k}}` : String(v); }); }
function parseTriggers(v){ if(!v) return []; if(Array.isArray(v)) return v; try{ return JSON.parse(v); }catch{ return []; } }
function includesTrigger(msg, trig){ const t = norm(String(trig)); if(!t) return false; if(t.length <= 3){ const re = new RegExp('(^|\\W)'+t+'(?=\\W|$)'); return re.test(msg); } return msg.includes(t); }
function tokenize(str){ return norm(str).split(/[^a-z0-9]+/).filter(t=>t.length>2); }
function jaccard(a, b){ const A = new Set(a); const B = new Set(b); const inter = new Set([...A].filter(x=>B.has(x))).size; const uni = new Set([...A, ...B]).size || 1; return inter / uni; }
function semanticRuleFallback(message, rules){ const msgTok = tokenize(message); let best = null; for(const r of rules){ const triggers = parseTriggers(r.triggers); for(const t of triggers){ const sc = jaccard(msgTok, tokenize(String(t))); if(sc >= 0.34){ if(!best || sc > best.score) best = { rule:r, score: sc }; } } } return best ? best.rule : null; }
function isPureGreeting(message){ const t = tokenize(message); const G = new Set(['hola','hey','buenas','buen','dia','día','tardes','noches','quetal','qué','tal','como','cómo','va','saludos']); const other = t.filter(x=> !G.has(x)); return other.length === 0 && t.length <= 5; }
async function getProductCatalog(bot_id, limit=20){ const rows = await queryBusinessDB('SELECT name FROM products WHERE bot_id=$1 ORDER BY id DESC LIMIT $2', [bot_id, limit]); return rows.map(r=>r.name); }
async function findProductLike(bot_id, message){ const msg = norm(message); const prods = await queryBusinessDB('SELECT * FROM products WHERE bot_id=$1 ORDER BY id DESC', [bot_id]); let best = null; for(const p of prods){ const name = norm(p.name||''); if(!name) continue; if(msg.includes(name) || name.split(' ').some(tok=> tok.length>2 && msg.includes(tok))){ if(!best || (p.name||'').length > (best.name||'').length) best = p; } } return best; }
async function ensureBotConfig(bot_id='default'){ const rows = await queryBotDB('SELECT * FROM bot_configs WHERE bot_id=$1', [bot_id]); if(rows.length) return rows[0]; await queryBotDB('INSERT INTO bot_configs(bot_id,mode,slot_minutes) VALUES($1,$2,$3)', [bot_id, 'sales', 30]); return (await queryBotDB('SELECT * FROM bot_configs WHERE bot_id=$1', [bot_id]))[0]; }
async function getBusinessProfile(bot_id='default'){ const [cfg] = await queryBotDB('SELECT * FROM bot_configs WHERE bot_id=$1', [bot_id]); return cfg || {}; }
function toISOorNull(s){ if(!s) return null; const t = String(s).replace('T',' '); const dt = DateTime.fromSQL(t, { zone:'America/Argentina/Cordoba' }); return dt.isValid ? dt.toISO({ suppressMilliseconds:true }) : null; }
async function ensureISODate(text){
  const direct = toISOorNull(text); if(direct) return direct;
  try{
    const str = norm(text);
    const dowMap = {'lunes':1,'martes':2,'miercoles':3,'miércoles':3,'jueves':4,'viernes':5,'sabado':6,'sábado':6,'domingo':7};
    let m = str.match(/(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)(?:\\s+(proximo|pr\\u00f3ximo))?.*?(\\d{1,2})(?::(\\d{2}))?/);
    if(m){
      const day = m[1]; const next = !!m[2];
      const hh = parseInt(m[3],10); const mm = m[4]?parseInt(m[4],10):0;
      const now = DateTime.now({ zone:'America/Argentina/Cordoba' });
      const targetDow = dowMap[day];
      let add = (targetDow + 7 - now.weekday) % 7;
      if(add===0) add = 7;
      if(next) add += 7;
      let d = now.plus({ days: add }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
      if(d <= now) d = d.plus({ days: 7 });
      return d.toISO({ suppressMilliseconds:true });
    }
  }catch(_e){}
  if(process.env.OPENAI_API_KEY){
    try{
      const sys = 'Convierte a ISO YYYY-MM-DDTHH:mm:ss en zona America/Argentina/Cordoba. Si no entiendes, responde null.';
      const user = 'Frase: \"'+text+'\". Responde SOLO el ISO o null.';
      const r = await axios.post('https://api.openai.com/v1/chat/completions',{ model:'gpt-4o-mini', temperature:0, messages:[{role:'system',content:sys},{role:'user',content:user}] },{ timeout:8000, headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` } });
      const out = (r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content || '').trim();
      const iso = toISOorNull(out); if(iso) return iso;
    }catch(_e){}
  }
  return null;
}
async function intentNLU(message, mode){
  if(!process.env.OPENAI_API_KEY) return { intent:'unknown', slots:{} };
  const sys = `Eres un clasificador. Devuelve JSON con {intent, slots}.
Intents permitidos (sales): ["ask_price","ask_stock","ask_catalog","greet","bye","ask_hours","ask_address","ask_payments"].
Intents permitidos (reservations): ["create_booking","check_availability","cancel_booking","ask_services","greet","bye","ask_hours","ask_address"].
Slots permitidos: product_name, date_time, customer, service. No inventes datos.`;
  const user = `Texto: "${message}". Modo: "${mode}". Responde SOLO JSON.`;
  const r = await axios.post('https://api.openai.com/v1/chat/completions',{ model:'gpt-4o-mini', response_format:{type:'json_object'}, temperature:0, messages:[{role:'system',content:sys},{role:'user',content:user}] },{ timeout:10000, headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` } });
  try{ return JSON.parse(r.data.choices[0].message.content); }catch{ return {intent:'unknown', slots:{}};}
}
async function naturalReply(context, userMessage, fallback){
  if(!process.env.OPENAI_API_KEY) return fallback;
  const sys = `Redacta una respuesta breve y natural en español usando SOLO este contexto JSON. No agregues datos nuevos. Si falta un dato, pídelo. Contexto: ${JSON.stringify(context)}`;
  const user = `Usuario: "${userMessage}"`;
  try{
    const r = await axios.post('https://api.openai.com/v1/chat/completions',{ model:'gpt-4o-mini', temperature:0.2, messages:[{role:'system',content:sys},{role:'user',content:user}] },{ timeout:8000, headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` } });
    return r.data.choices?.[0]?.message?.content || fallback;
  }catch{ return fallback; }
}
initDB().catch(err=>{ console.error('DB init error', err); process.exit(1); });
app.get('/healthz', (_req,res)=> res.json({ ok:true, ts: Date.now() }));
const cfgPatchSchema = z.object({ bot_id:z.string().min(1).optional(), mode:z.enum(['sales','reservations']).optional(), name:z.string().optional(), address:z.string().optional(), hours:z.string().optional(), phone:z.string().optional(), payment_methods:z.string().optional(), cash_discount:z.string().optional(), service_list:z.string().optional(), cancellation_policy:z.string().optional(), slot_minutes:z.number().int().min(5).max(240).optional() });
const productCreateSchema = z.object({ bot_id:z.string().default('default'), name:z.string().min(1), price:z.number().nonnegative(), stock:z.number().int().nonnegative() });
const apptCreateSchema = z.object({ bot_id:z.string().default('default'), customer:z.string().min(1), starts_at:z.string().min(5), notes:z.string().optional() });
app.get('/api/config', async (req,res)=>{ try{ const bot_id = req.query.bot_id || 'default'; const cfg = await ensureBotConfig(bot_id); res.json({ ok:true, config: cfg }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.post('/api/config', async (req,res)=>{ try{ const parsed = cfgPatchSchema.safeParse(req.body||{}); if(!parsed.success) return res.status(400).json({ ok:false, error:'Bad config payload' }); const { bot_id='default', ...patch } = parsed.data; await ensureBotConfig(bot_id); const keys = Object.keys(patch); if(keys.length){ const sets = keys.map((k,i)=> `${k}=$${i+2}`).join(', '); const vals = keys.map(k=> patch[k]); await queryBotDB(`UPDATE bot_configs SET ${sets} WHERE bot_id=$1`, [bot_id, ...vals]); } res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.get('/api/rules', async (req,res)=>{ try{ const bot_id = req.query.bot_id || 'default'; const mode = req.query.mode; const sql = mode ? 'SELECT * FROM business_rules WHERE bot_id=$1 AND mode=$2 ORDER BY priority DESC' : 'SELECT * FROM business_rules WHERE bot_id=$1 ORDER BY priority DESC'; const rows = await queryBusinessDB(sql, mode ? [bot_id, mode] : [bot_id]); res.json(rows); }catch(e){ res.status(500).json({ error: e.message }); } });
app.post('/api/rules', async (req,res)=>{ try{ const { bot_id='default', mode, condition, triggers=[], action, priority=50 } = req.body || {}; await queryBusinessDB('INSERT INTO business_rules(bot_id,mode,condition,triggers,action,priority) VALUES($1,$2,$3,$4,$5,$6)', [bot_id, mode, condition, JSON.stringify(triggers), action, priority]); res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.put('/api/rules/:id', async (req,res)=>{ try{ const id = req.params.id; const { bot_id='default', mode, condition, triggers=[], action, priority=50 } = req.body || {}; await queryBusinessDB('UPDATE business_rules SET bot_id=$2, mode=$3, condition=$4, triggers=$5, action=$6, priority=$7 WHERE id=$1', [id, bot_id, mode, condition, JSON.stringify(triggers), action, priority]); res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.delete('/api/rules/:id', async (req,res)=>{ try{ const id = req.params.id; await queryBusinessDB('DELETE FROM business_rules WHERE id=$1',[id]); res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.post('/api/rules/restore-defaults', async (req,res)=>{ try{ const bot_id = (req.body && req.body.bot_id) || 'default'; await queryBusinessDB('DELETE FROM business_rules WHERE bot_id=$1', [bot_id]); const fs = require('fs'); const defaults = JSON.parse(fs.readFileSync(path.join(__dirname,'rules.json'),'utf-8')); const all = [...(defaults.common||[]), ...(defaults.sales||[]), ...(defaults.reservations||[])]; for(const r of all){ await queryBusinessDB('INSERT INTO business_rules(bot_id,mode,condition,triggers,action,priority) VALUES($1,$2,$3,$4,$5,$6)', [bot_id, r.mode, r.condition, JSON.stringify(r.triggers||[]), r.action, r.priority||50]); } res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.get('/api/products', async (req,res)=>{ try{ const bot_id = req.query.bot_id || 'default'; const rows = await queryBusinessDB('SELECT * FROM products WHERE bot_id=$1 ORDER BY id DESC', [bot_id]); res.json(rows); }catch(e){ res.status(500).json({ error:e.message }); } });
app.post('/api/products', async (req,res)=>{ try{ const parsed = productCreateSchema.safeParse(req.body||{}); if(!parsed.success) return res.status(400).json({ ok:false, error:'Bad product payload' }); const { bot_id, name, price, stock } = parsed.data; await queryBusinessDB('INSERT INTO products(bot_id,name,price,stock) VALUES($1,$2,$3,$4)', [bot_id, name, price, stock]); res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.get('/api/appointments', async (req,res)=>{ try{ const bot_id = req.query.bot_id || 'default'; const rows = await queryBusinessDB('SELECT * FROM appointments WHERE bot_id=$1 ORDER BY starts_at DESC', [bot_id]); res.json(rows); }catch(e){ res.status(500).json({ error:e.message }); } });
app.get('/api/appointments/available', async (req,res)=>{ try{ const bot_id = req.query.bot_id || 'default'; const starts_at = await ensureISODate(req.query.starts_at); if(!starts_at) return res.status(400).json({ ok:false, error:'Fecha inválida' }); const [cfg] = await queryBotDB('SELECT slot_minutes FROM bot_configs WHERE bot_id=$1',[bot_id]); const slot = Number(cfg?.slot_minutes || 30); const rows = await queryBusinessDB(`SELECT id FROM appointments WHERE bot_id=$1 AND starts_at BETWEEN ($2::timestamp - ($3 * interval '1 minute')) AND ($2::timestamp + ($3 * interval '1 minute')) LIMIT 1`, [bot_id, starts_at, slot]); res.json({ ok:true, available: rows.length===0 }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.post('/api/appointments', async (req,res)=>{ try{ const parsed = apptCreateSchema.safeParse(req.body||{}); if(!parsed.success) return res.status(400).json({ ok:false, error:'Bad appointment payload' }); const { bot_id, customer, starts_at, notes } = parsed.data; const iso = await ensureISODate(starts_at); if(!iso) return res.status(400).json({ ok:false, error:'Fecha inválida' }); const [cfg] = await queryBotDB('SELECT slot_minutes FROM bot_configs WHERE bot_id=$1',[bot_id]); const slot = Number(cfg?.slot_minutes || 30); const clash = await queryBusinessDB(`SELECT id FROM appointments WHERE bot_id=$1 AND starts_at BETWEEN ($2::timestamp - ($3 * interval '1 minute')) AND ($2::timestamp + ($3 * interval '1 minute')) LIMIT 1`, [bot_id, iso, slot]); if(clash.length) return res.status(409).json({ ok:false, error:'Horario no disponible' }); await queryBusinessDB('INSERT INTO appointments(bot_id,customer,starts_at,notes) VALUES($1,$2,$3,$4)', [bot_id, customer, iso.replace('T',' ').slice(0,19), notes||null]); res.json({ ok:true }); }catch(e){ res.status(500).json({ ok:false, error:e.message }); } });
app.post('/api/chat', async (req,res)=>{
  try{
    const { message = '', bot_id='default' } = req.body || {};
    const cfg = await ensureBotConfig(bot_id);
    const rules = await queryBusinessDB('SELECT * FROM business_rules WHERE bot_id=$1 AND (mode=$2 OR mode=$3) ORDER BY priority DESC', [bot_id, cfg.mode, 'common']);
    const msg = norm(message);
    let matched = null;
    for (const r of rules) {
      /* GREETING GUARD */
      if(r.condition==='saludo_basico' && !isPureGreeting(message)) { continue; }
      const triggers = parseTriggers(r.triggers);
      for (const t of triggers) { if (includesTrigger(msg, t)) { matched = r; break; } }
      if (matched) break;
    }
    if(!matched){ matched = semanticRuleFallback(message, rules); }
    const profile = await getBusinessProfile(bot_id);
    const ctxBase = { name: profile.name, address: profile.address, hours: profile.hours, phone: profile.phone, payment_methods: profile.payment_methods, cash_discount: profile.cash_discount, service_list: profile.service_list, cancellation_policy: profile.cancellation_policy, date_time: '', product_catalog: '' };
    try{ const names = await getProductCatalog(bot_id, 20); if(names.length) ctxBase.product_catalog = names.join(', '); }catch{}
    if(matched){
      let ctx = { ...ctxBase };
      if(/\{product_name\}|\{price\}|\{stock\}/.test(matched.action)){ const p = await findProductLike(bot_id, message); if(p){ ctx.product_name = p.name; ctx.price = p.price; ctx.stock = p.stock; } }
      let replyTpl = fillTemplate(matched.action, ctx);
      if(/\{[a-z_]+\}/i.test(replyTpl)){
        if(/\{product_name\}|\{price\}|\{stock\}/.test(matched.action)){
          const names = await getProductCatalog(bot_id, 20);
          replyTpl = names.length ? ('Algunos productos: ' + names.join(', ') + '. Decime cuál te interesa.') : 'No tengo productos cargados.';
        } else if(/\{date_time\}/.test(matched.action)){
          replyTpl = 'Decime día y hora'+(ctx.hours?(' (horarios: '+ctx.hours+')'):'')+'.';
        } else {
          replyTpl = 'Necesito un dato más para responderte. ¿Podés aclarar?';
        }
      }
      return res.json({ ok:true, reply: replyTpl });
    }
    if(!process.env.OPENAI_API_KEY){
      let reply;
      if(cfg.mode==='sales'){ const names = await getProductCatalog(bot_id, 20); reply = names.length ? ('Vendemos: ' + names.join(', ') + '. Decime cuál te interesa.') : 'No tengo productos cargados.'; }
      else { reply = (profile.service_list ? ('Servicios: ' + profile.service_list + '. ') : '') + 'Decime día y hora y verifico disponibilidad.'; }
      return res.json({ ok:true, reply });
    }
    const { intent, slots } = await intentNLU(message, cfg.mode);
    let reply = '¿Podés reformular?';
    if(cfg.mode === 'sales'){
      if(intent === 'ask_catalog'){ const names = await getProductCatalog(bot_id, 20); reply = names.length ? ('Vendemos: ' + names.join(', ') + '. Decime cuál te interesa.') : 'Aún no hay productos cargados.'; }
      else if(intent === 'ask_price' || intent === 'ask_stock'){
        const explicit = slots.product_name; let p = null;
        if(explicit){ const r = await queryBusinessDB('SELECT * FROM products WHERE bot_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1',[bot_id, explicit]); p = r[0]; }
        if(!p) p = await findProductLike(bot_id, message);
        reply = p ? `Tenemos ${p.name}. Precio $${p.price}. Stock ${p.stock}.` : ((await getProductCatalog(bot_id,20)).length ? ('No pasa nada. Algunos productos: ' + (await getProductCatalog(bot_id,20)).join(', ') + '. Decime cuál te interesa.') : 'No tengo productos cargados.');
      } else if(intent === 'ask_hours'){ reply = profile.hours ? `Nuestro horario es: ${profile.hours}.` : 'No tengo horario configurado.'; }
      else if(intent === 'ask_address'){ reply = profile.address ? `Estamos en ${profile.address}.` : 'No tengo dirección configurada.'; }
      else if(intent === 'ask_payments'){ reply = profile.payment_methods ? `Medios de pago: ${profile.payment_methods}.` : 'No tengo medios de pago configurados.'; }
    } else if(cfg.mode === 'reservations'){
      if(intent === 'ask_services'){ reply = profile.service_list ? ('Servicios: ' + profile.service_list + '.') : 'No tengo servicios configurados.'; }
      else if(intent === 'check_availability' || intent === 'create_booking'){
        const dt = await ensureISODate(slots.date_time || message);
        if(!dt){ reply = `Decime día y hora. Horarios: ${profile.hours||'no configurado'}.`; }
        else{
          const [cfgRow] = await queryBotDB('SELECT slot_minutes FROM bot_configs WHERE bot_id=$1',[bot_id]);
          const slot = Number(cfgRow?.slot_minutes || 30);
          const clash = await queryBusinessDB(`SELECT id FROM appointments WHERE bot_id=$1 AND starts_at BETWEEN ($2::timestamp - ($3 * interval '1 minute')) AND ($2::timestamp + ($3 * interval '1 minute')) LIMIT 1`, [bot_id, dt, slot]);
          if(clash.length){ reply = 'Ese horario no está disponible. ¿Querés que te proponga alternativas?'; }
          else if(intent === 'create_booking'){
            await queryBusinessDB('INSERT INTO appointments(bot_id,customer,starts_at,notes) VALUES($1,$2,$3,$4)', [bot_id, slots.customer||'Cliente', dt.replace('T',' ').slice(0,19), slots.service||null]);
            reply = `Listo. Turno para ${slots.customer||'cliente'} el ${dt}.`;
          } else { reply = 'Hay disponibilidad. ¿Querés confirmar el turno?'; }
        }
      } else if(intent === 'cancel_booking'){ reply = `Tu turno fue cancelado. Política: ${profile.cancellation_policy||'no configurada'}.`; }
      else if(intent === 'ask_hours'){ reply = profile.hours ? `Atendemos: ${profile.hours}.` : 'No tengo horario configurado.'; }
      else if(intent === 'ask_address'){ reply = profile.address ? `Estamos en ${profile.address}.` : 'No tengo dirección configurada.'; }
    }
    if(intent === 'greet') reply = 'Hola, ¿en qué puedo ayudarte?';
    if(intent === 'bye') reply = 'Gracias por tu visita.';
    if(intent === 'unknown'){ if(cfg.mode==='sales'){ const names = await getProductCatalog(bot_id, 20); reply = names.length ? ('Puedo ayudarte con precios y stock. Algunos productos: ' + names.join(', ') + '.') : 'Puedo ayudarte con precios y stock. Cargá productos primero.'; } else { reply = (profile.service_list ? ('Podés reservar: ' + profile.service_list + '. ') : '') + 'Decime día y hora y verifico.'; } }
    const context = { mode: cfg.mode, reply, hours: profile.hours||null, address: profile.address||null, payments: profile.payment_methods||null, catalog: (await getProductCatalog(bot_id,10)).join(', ')||null };
    const finalReply = await naturalReply(context, message, reply);
    res.json({ ok:true, reply: finalReply });
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:e.message }); }
});
app.use('/api/*', (_req,res)=> res.status(404).json({ ok:false, error:'Not found' }));
app.listen(PORT, ()=>{ console.log(`Server on :${PORT}`); });

require('dotenv').config();
const { queryBotDB, queryBusinessDB } = require('./db');
async function initBotDB(){
  await queryBotDB(`
    CREATE TABLE IF NOT EXISTS bot_configs (
      bot_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'sales',
      rules JSONB,
      name TEXT,
      address TEXT,
      hours TEXT,
      phone TEXT,
      payment_methods TEXT,
      cash_discount TEXT,
      service_list TEXT,
      cancellation_policy TEXT,
      slot_minutes INTEGER NOT NULL DEFAULT 30
    );`, []);
  const exists = await queryBotDB('SELECT 1 FROM bot_configs WHERE bot_id=$1', ['default']);
  if(!exists.length){ await queryBotDB('INSERT INTO bot_configs(bot_id,mode,slot_minutes) VALUES($1,$2,$3)', ['default','sales',30]); }
}
async function initBusinessDB(){
  await queryBusinessDB(`
    CREATE TABLE IF NOT EXISTS products(id SERIAL PRIMARY KEY, name TEXT NOT NULL, price NUMERIC(12,2) NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, bot_id TEXT);
    CREATE TABLE IF NOT EXISTS appointments(id SERIAL PRIMARY KEY, customer TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, notes TEXT, bot_id TEXT);
    CREATE TABLE IF NOT EXISTS business_rules(id SERIAL PRIMARY KEY, mode TEXT NOT NULL, condition TEXT NOT NULL, triggers JSONB, action TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 50, bot_id TEXT);
    CREATE TABLE IF NOT EXISTS pending_intents(
      bot_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      date_time TIMESTAMPTZ,
      service TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(bot_id, session_id)
    );
  `, []);
  await queryBusinessDB(`DO $$ BEGIN
    BEGIN ALTER TABLE appointments ALTER COLUMN starts_at TYPE TIMESTAMPTZ USING (starts_at AT TIME ZONE 'America/Argentina/Cordoba'); EXCEPTION WHEN others THEN NULL; END;
    BEGIN ALTER TABLE pending_intents ALTER COLUMN date_time TYPE TIMESTAMPTZ USING (date_time AT TIME ZONE 'America/Argentina/Cordoba'); EXCEPTION WHEN others THEN NULL; END;
  END $$;`, []);
  await queryBusinessDB(`UPDATE products SET bot_id='default' WHERE bot_id IS NULL`, []);
  await queryBusinessDB(`ALTER TABLE products ALTER COLUMN bot_id SET NOT NULL`, []);
  await queryBusinessDB(`CREATE INDEX IF NOT EXISTS idx_products_bot ON products(bot_id)`, []);
  await queryBusinessDB(`UPDATE appointments SET bot_id='default' WHERE bot_id IS NULL`, []);
  await queryBusinessDB(`ALTER TABLE appointments ALTER COLUMN bot_id SET NOT NULL`, []);
  await queryBusinessDB(`CREATE INDEX IF NOT EXISTS idx_appointments_bot ON appointments(bot_id)`, []);
  await queryBusinessDB(`CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(starts_at)`, []);
  await queryBusinessDB(`UPDATE business_rules SET bot_id='default' WHERE bot_id IS NULL`, []);
  await queryBusinessDB(`ALTER TABLE business_rules ALTER COLUMN bot_id SET NOT NULL`, []);
  await queryBusinessDB(`CREATE INDEX IF NOT EXISTS idx_rules_bot ON business_rules(bot_id)`, []);
  const fs = require('fs'); const path = require('path');
  const cnt = await queryBusinessDB('SELECT COUNT(*)::int AS c FROM business_rules WHERE bot_id=$1', ['default']);
  if(!cnt[0] || cnt[0].c === 0){
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname,'rules.json'),'utf-8'));
    const all = [...(defaults.common||[]), ...(defaults.sales||[]), ...(defaults.reservations||[])];
    for(const r of all){
      await queryBusinessDB('INSERT INTO business_rules(bot_id,mode,condition,triggers,action,priority) VALUES($1,$2,$3,$4,$5,$6)', ['default', r.mode, r.condition, JSON.stringify(r.triggers||[]), r.action, r.priority||50]);
    }
  }
}
async function initDB(){ await initBotDB(); await initBusinessDB(); console.log('DB OK'); }
if(require.main === module){ initDB().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); }); }
module.exports = { initDB };

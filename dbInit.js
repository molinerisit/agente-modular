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
      cancellation_policy TEXT
    );
  `, []);
  // ensure default row
  const r = await queryBotDB('SELECT 1 FROM bot_configs WHERE bot_id=$1', ['default']);
  if(!r.length){
    await queryBotDB('INSERT INTO bot_configs(bot_id,mode) VALUES($1,$2)', ['default','sales']);
  }
}

async function initBusinessDB(){
  await queryBusinessDB(`
    CREATE TABLE IF NOT EXISTS products(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS appointments(
      id SERIAL PRIMARY KEY,
      customer TEXT NOT NULL,
      starts_at TIMESTAMP NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS business_rules(
      id SERIAL PRIMARY KEY,
      mode TEXT NOT NULL,
      condition TEXT NOT NULL,
      triggers JSONB,
      action TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50
    );
  `, []);
  const cnt = await queryBusinessDB('SELECT COUNT(*)::int AS c FROM business_rules', []);
  if(!cnt[0] || cnt[0].c === 0){
    const fs = require('fs');
    const path = require('path');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname,'rules.json'), 'utf-8'));
    const all = [...(defaults.common||[]), ...(defaults.sales||[]), ...(defaults.reservations||[])];
    for(const r of all){
      await queryBusinessDB(
        'INSERT INTO business_rules(mode,condition,triggers,action,priority) VALUES($1,$2,$3,$4,$5)',
        [r.mode, r.condition, JSON.stringify(r.triggers||[]), r.action, r.priority||50]
      );
    }
  }
}

async function initDB(){
  await initBotDB();
  await initBusinessDB();
  console.log('DB OK');
}

if(require.main === module){
  initDB().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });
}

module.exports = { initDB };

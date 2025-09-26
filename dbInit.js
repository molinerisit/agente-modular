const fs = require('fs');
const { queryBotDB, queryBusinessDB } = require('./db');

async function initBotDB(){
  await queryBotDB(`
    CREATE TABLE IF NOT EXISTS bot_configs (
      bot_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'sales',
      rules JSONB
    );
  `);
}

async function initBusinessDB(){
  await queryBusinessDB(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT,
      price NUMERIC,
      stock INTEGER,
      meta JSONB
    );
  `);
  await queryBusinessDB(`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      customer TEXT,
      starts_at TIMESTAMP,
      notes TEXT
    );
  `);
  await queryBusinessDB(`
    CREATE TABLE IF NOT EXISTS business_rules (
      id SERIAL PRIMARY KEY,
      mode TEXT NOT NULL,
      condition TEXT,
      triggers JSONB,
      action TEXT,
      priority INTEGER DEFAULT 50
    );
  `);
  // precarga si está vacía
  const rows = await queryBusinessDB('SELECT COUNT(*) AS c FROM business_rules', []);
  if(rows && rows[0] && Number(rows[0].c) === 0){
    try{
      const js = JSON.parse(fs.readFileSync('./rules.json', 'utf8'));
      const insert = 'INSERT INTO business_rules (mode, condition, triggers, action, priority) VALUES ($1,$2,$3,$4,$5)';
      for(const group of ['common','sales','reservations']){
        if(!js[group]) continue;
        for(const r of js[group]){
          await queryBusinessDB(insert, [r.mode, r.condition, JSON.stringify(r.triggers), r.action, r.priority || 50]);
        }
      }
      console.log('Preloaded business rules.');
    }catch(e){
      console.error('Failed to preload rules:', e.message);
    }
  }
}

async function initDB() {
  console.log('Initializing DBs...');
  await initBotDB();
  await initBusinessDB();
  console.log('DBs initialized.');
}

module.exports = { initDB };
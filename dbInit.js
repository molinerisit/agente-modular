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
      key TEXT,
      value TEXT
    );
  `);
}

async function initDB() {
  console.log('Initializing DBs...');
  await initBotDB();
  await initBusinessDB();
  console.log('DBs initialized.');
}

module.exports = { initDB };
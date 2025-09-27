require('dotenv').config();
const { Pool } = require('pg');

const botPool = new Pool({ connectionString: process.env.BOT_DB_URL, ssl: process.env.BOT_DB_URL?.includes('railway.app') ? { rejectUnauthorized: false } : undefined });
const businessPool = new Pool({ connectionString: process.env.BUSINESS_DB_URL, ssl: process.env.BUSINESS_DB_URL?.includes('railway.app') ? { rejectUnauthorized: false } : undefined });

async function queryBotDB(text, params){
  const c = await botPool.connect();
  try{ const r = await c.query(text, params); return r.rows; }
  finally{ c.release(); }
}
async function queryBusinessDB(text, params){
  const c = await businessPool.connect();
  try{ const r = await c.query(text, params); return r.rows; }
  finally{ c.release(); }
}

module.exports = { queryBotDB, queryBusinessDB };

require('dotenv').config();
const { Pool } = require('pg');

const botDbUrl = process.env.BOT_DB_URL;
const businessDbUrl = process.env.BUSINESS_DB_URL;

const botPool = botDbUrl ? new Pool({ connectionString: botDbUrl }) : null;
const businessPool = businessDbUrl ? new Pool({ connectionString: businessDbUrl }) : null;

async function queryBotDB(text, params) {
  if(!botPool) throw new Error('BOT_DB_URL not configured in .env');
  const res = await botPool.query(text, params);
  return res.rows;
}
async function queryBusinessDB(text, params) {
  if(!businessPool) throw new Error('BUSINESS_DB_URL not configured in .env');
  const res = await businessPool.query(text, params);
  return res.rows;
}

module.exports = { queryBotDB, queryBusinessDB, botPool, businessPool };
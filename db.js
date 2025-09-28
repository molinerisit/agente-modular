require('dotenv').config();
const { Pool } = require('pg');
function sslOpt(url){ if(process.env.PGSSLMODE === 'require') return { rejectUnauthorized: false }; if(!url) return undefined; return url.includes('railway.app') ? { rejectUnauthorized: false } : undefined; }
const botPool = new Pool({ connectionString: process.env.BOT_DB_URL, ssl: sslOpt(process.env.BOT_DB_URL) });
const businessPool = new Pool({ connectionString: process.env.BUSINESS_DB_URL, ssl: sslOpt(process.env.BUSINESS_DB_URL) });
async function query(pool, text, params){ const c = await pool.connect(); try{ const r = await c.query(text, params); return r.rows; } finally{ c.release(); } }
module.exports = { queryBotDB:(t,p)=>query(botPool,t,p), queryBusinessDB:(t,p)=>query(businessPool,t,p) };

const { Pool } = require('pg');
const { databaseUrl } = require('./config');

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({ connectionString: databaseUrl });

async function healthcheck() {
  await pool.query('SELECT 1');
}

module.exports = {
  pool,
  healthcheck
};

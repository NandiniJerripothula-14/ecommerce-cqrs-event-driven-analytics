const amqp = require('amqplib');
const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ connectionString: process.env.READ_DATABASE_URL });
  const connection = await amqp.connect(process.env.BROKER_URL);
  await pool.query('SELECT 1');
  await connection.close();
  await pool.end();
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

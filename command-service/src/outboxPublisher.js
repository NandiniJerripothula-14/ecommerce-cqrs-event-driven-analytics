const { pool } = require('./db');
const { publish } = require('./broker');
const { outboxBatchSize, outboxPollIntervalMs } = require('./config');

let timer;

async function publishBatch() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
      SELECT id, topic, payload
      FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [outboxBatchSize]
    );

    for (const row of result.rows) {
      await publish(row.topic, row.payload);
      await client.query('UPDATE outbox SET published_at = NOW() WHERE id = $1', [row.id]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Outbox publish failed:', error.message);
  } finally {
    client.release();
  }
}

function startOutboxPublisher() {
  timer = setInterval(() => {
    publishBatch().catch((error) => {
      console.error('Outbox interval error:', error.message);
    });
  }, outboxPollIntervalMs);
}

function stopOutboxPublisher() {
  if (timer) {
    clearInterval(timer);
  }
}

module.exports = {
  startOutboxPublisher,
  stopOutboxPublisher,
  publishBatch
};

const amqp = require('amqplib');
const { Pool } = require('pg');
const { applyEvent } = require('./projections');
const { brokerUrl, readDatabaseUrl, exchangeName, queueName } = require('./config');

if (!brokerUrl || !readDatabaseUrl) {
  throw new Error('BROKER_URL and READ_DATABASE_URL are required');
}

const pool = new Pool({ connectionString: readDatabaseUrl });

async function processMessage(msg, channel) {
  const event = JSON.parse(msg.content.toString());
  const eventId = event.eventId;

  if (!eventId) {
    channel.ack(msg);
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const idempotencyInsert = await client.query(
      'INSERT INTO processed_events(event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING',
      [eventId]
    );

    if (idempotencyInsert.rowCount === 0) {
      await client.query('COMMIT');
      channel.ack(msg);
      return;
    }

    await applyEvent(client, event);

    await client.query('COMMIT');
    channel.ack(msg);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Consumer error:', error.message);
    channel.nack(msg, false, true);
  } finally {
    client.release();
  }
}

async function run() {
  const connection = await amqp.connect(brokerUrl);
  const channel = await connection.createChannel();

  await channel.assertExchange(exchangeName, 'topic', { durable: true });
  const assertedQueue = await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(assertedQueue.queue, exchangeName, '#');
  channel.prefetch(20);

  await channel.consume(assertedQueue.queue, (msg) => {
    if (!msg) {
      return;
    }
    processMessage(msg, channel).catch((error) => {
      console.error('Unhandled processing error:', error.message);
      channel.nack(msg, false, true);
    });
  });

  console.log('Consumer service listening for events');
}

run().catch((error) => {
  console.error('Consumer startup failure:', error.message);
  process.exit(1);
});

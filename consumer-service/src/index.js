const amqp = require('amqplib');
const { Pool } = require('pg');
const { applyEvent } = require('./projections');
const {
  brokerUrl,
  readDatabaseUrl,
  exchangeName,
  queueName,
  dlqExchangeName,
  dlqQueueName,
  maxRetries
} = require('./config');

if (!brokerUrl || !readDatabaseUrl) {
  throw new Error('BROKER_URL and READ_DATABASE_URL are required');
}

const pool = new Pool({ connectionString: readDatabaseUrl });

async function moveToDlq(channel, msg, event, reason) {
  const routingKey = event?.eventType || msg.fields.routingKey || 'unknown';
  const headers = {
    ...(msg.properties.headers || {}),
    'x-dlq-reason': String(reason || 'processing_error')
  };

  channel.publish(dlqExchangeName, routingKey, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType || 'application/json',
    headers
  });

  channel.ack(msg);
}

async function retryOrDlq(channel, msg, event, error) {
  const currentRetryCount = Number(msg.properties?.headers?.['x-retry-count'] || 0);

  if (currentRetryCount < maxRetries) {
    const headers = {
      ...(msg.properties.headers || {}),
      'x-retry-count': currentRetryCount + 1
    };

    channel.publish(exchangeName, msg.fields.routingKey, msg.content, {
      persistent: true,
      contentType: msg.properties.contentType || 'application/json',
      headers
    });

    channel.ack(msg);
    return;
  }

  await moveToDlq(channel, msg, event, error?.message || 'max_retries_exceeded');
}

async function processMessage(msg, channel) {
  let event;
  try {
    event = JSON.parse(msg.content.toString());
  } catch (error) {
    console.error('Invalid event payload:', error.message);
    await moveToDlq(channel, msg, null, 'invalid_json');
    return;
  }

  const eventId = event.eventId;

  if (!eventId) {
    await moveToDlq(channel, msg, event, 'missing_event_id');
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
    await retryOrDlq(channel, msg, event, error);
  } finally {
    client.release();
  }
}

async function run() {
  const connection = await amqp.connect(brokerUrl);
  const channel = await connection.createChannel();

  await channel.assertExchange(exchangeName, 'topic', { durable: true });
  await channel.assertExchange(dlqExchangeName, 'topic', { durable: true });

  const assertedQueue = await channel.assertQueue(queueName, {
    durable: true
  });

  const assertedDlq = await channel.assertQueue(dlqQueueName, { durable: true });
  await channel.bindQueue(assertedQueue.queue, exchangeName, '#');
  await channel.bindQueue(assertedDlq.queue, dlqExchangeName, '#');
  channel.prefetch(20);

  await channel.consume(assertedQueue.queue, (msg) => {
    if (!msg) {
      return;
    }
    processMessage(msg, channel).catch((error) => {
      console.error('Unhandled processing error:', error.message);
      retryOrDlq(channel, msg, null, error).catch((retryError) => {
        console.error('Retry/DLQ fallback failed:', retryError.message);
        channel.ack(msg);
      });
    });
  });

  console.log('Consumer service listening for events');
}

run().catch((error) => {
  console.error('Consumer startup failure:', error.message);
  process.exit(1);
});

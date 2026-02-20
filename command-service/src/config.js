module.exports = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL,
  brokerUrl: process.env.BROKER_URL,
  exchangeName: process.env.EXCHANGE_NAME || 'ecommerce.events',
  outboxPollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS || 2000),
  outboxBatchSize: Number(process.env.OUTBOX_BATCH_SIZE || 50)
};

module.exports = {
  brokerUrl: process.env.BROKER_URL,
  readDatabaseUrl: process.env.READ_DATABASE_URL,
  exchangeName: process.env.EXCHANGE_NAME || 'ecommerce.events',
  queueName: process.env.QUEUE_NAME || 'analytics.readmodel',
  dlqExchangeName: process.env.DLQ_EXCHANGE || 'ecommerce.dlx',
  dlqQueueName: process.env.DLQ_QUEUE || 'analytics.readmodel.dlq',
  maxRetries: Number(process.env.MAX_RETRIES || 3)
};

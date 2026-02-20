module.exports = {
  brokerUrl: process.env.BROKER_URL,
  readDatabaseUrl: process.env.READ_DATABASE_URL,
  exchangeName: process.env.EXCHANGE_NAME || 'ecommerce.events',
  queueName: process.env.QUEUE_NAME || 'analytics.readmodel'
};

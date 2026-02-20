const amqp = require('amqplib');
const { brokerUrl, exchangeName } = require('./config');

let connection;
let channel;

async function getChannel() {
  if (channel) {
    return channel;
  }

  if (!brokerUrl) {
    throw new Error('BROKER_URL is required');
  }

  connection = await amqp.connect(brokerUrl);
  channel = await connection.createChannel();
  await channel.assertExchange(exchangeName, 'topic', { durable: true });

  connection.on('close', () => {
    connection = null;
    channel = null;
  });

  connection.on('error', () => {
    connection = null;
    channel = null;
  });

  return channel;
}

async function publish(topic, payload) {
  const activeChannel = await getChannel();
  const published = activeChannel.publish(
    exchangeName,
    topic,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: 'application/json' }
  );

  if (!published) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

module.exports = {
  publish,
  getChannel
};

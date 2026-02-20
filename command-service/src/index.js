const app = require('./app');
const { port } = require('./config');
const { startOutboxPublisher, publishBatch } = require('./outboxPublisher');

app.listen(port, async () => {
  console.log(`Command service listening on ${port}`);
  await publishBatch();
  startOutboxPublisher();
});

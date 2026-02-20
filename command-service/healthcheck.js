const http = require('http');

const req = http.get('http://127.0.0.1:8080/health', (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  }
  process.exit(1);
});

req.on('error', () => process.exit(1));
req.setTimeout(3000, () => {
  req.destroy();
  process.exit(1);
});

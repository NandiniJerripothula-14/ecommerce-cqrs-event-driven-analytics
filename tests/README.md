# Test Notes

This folder contains automated integration tests.

Run after starting containers:

```bash
npm run test:integration
```

Optional environment overrides:

```bash
COMMAND_BASE_URL=http://localhost:8080
QUERY_BASE_URL=http://localhost:8081
POLL_TIMEOUT_MS=30000
POLL_INTERVAL_MS=1000
```

The integration test validates eventual consistency by:

1. Execute command request (create product/order).
2. Poll query endpoint until expected projection appears (or timeout).
3. Assert response payload and metrics.

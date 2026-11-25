# Queue worker

The worker consumes versioned AMQP JSON events from durable quorum queues:

- `reviews.created` persists a review to MongoDB. `Idempotency-Key` is stored under a unique sparse index so redelivery cannot create duplicates.
- `catalog.refresh` queries the ten cheapest catalog items once and fills the shared Redis cache for 60 seconds.
- `catalog.changed` invalidates the catalog cache.

Review processing retries through a five-second quorum retry queue up to five deliveries, then moves the message to `reviews.dlq`. RabbitMQ publisher confirms make the API return `202 Accepted` only after the broker accepts the event. The review GET endpoint becomes consistent after the worker commits it to MongoDB.

Example request:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/products/ST-001/reviews `
  -ContentType 'application/json' `
  -Headers @{ 'Idempotency-Key' = 'review-st001-001' } `
  -Body '{"reviewer":"Alex","rating":5,"comment":"Works well."}'
```

For the local cluster, build and import both images before Flux reconciles the dev overlays:

```powershell
docker build -t store-api:phase3 .\application
k3d image import store-api:phase3 --cluster distributed-lab
docker build -t store-worker:phase3 .\worker
k3d image import store-worker:phase3 --cluster distributed-lab
```

After Flux reports the `store-queue` RabbitmqCluster ready, run `scripts/setup-phase3-secrets.ps1` to copy its generated credentials into the application namespace. Flux will then start the API and worker pods.

The three RabbitMQ replicas use local persistent volumes. Their quorum queues survive a single node loss, but the lab has no cross-host storage or network fault isolation.

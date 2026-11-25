# Observabilidad local

El stack de desarrollo reúne Grafana, Loki, Tempo, Prometheus y el receptor OTLP en `grafana/otel-lgtm`. Prometheus ocupa el lugar de Mimir en este laboratorio de una sola laptop. El colector OpenTelemetry agente lee logs de los pods y métricas del nodo; el gateway añade atributos de Kubernetes y deriva métricas RED de las trazas.

Grafana está disponible en `http://grafana.localhost:8081`. Antes de sincronizar Flux, define `GRAFANA_ADMIN_PASSWORD` en `.env` y ejecuta:

```powershell
.\scripts\setup-phase6-secrets.ps1
```

La imagen del API en el overlay local es `store-api:phase6` con `imagePullPolicy: Never`. Antes de fusionar este cambio en la laptop, constrúyela e impórtala al clúster:

```powershell
docker build -t store-api:phase6 .\application
k3d image import store-api:phase6 --cluster distributed-lab
```

El overlay usa la imagen web `store-web-site1:phase6`; constrúyela e impórtala también:

```powershell
docker build --build-arg SITE=site1 -t store-web-site1:phase6 .\web
k3d image import store-web-site1:phase6 --cluster distributed-lab
```

La instrumentación del navegador captura la carga inicial y las llamadas `fetch`. Nginx exporta spans del proxy al gateway OTLP y sirve el endpoint HTTP del navegador en `/v1/traces`. Grafana incluye tableros RED del API y salud del clúster, además de alertas de latencia p95 y consumo rápido o sostenido del presupuesto de error. Las alertas se consultan en Grafana; todavía no tienen un receptor externo de notificaciones.

El tablero RED muestra la tasa de aciertos y fallos de Redis mediante el contador `store_catalog_cache_requests_total`. Las métricas de profundidad de RabbitMQ y salud de Galera se incorporarán cuando sus componentes y exporters queden desplegados en las fases correspondientes.

El chart upstream todo en uno y esta configuración están pensados para laboratorio. El límite de memoria de Grafana/LGTM es 2 GiB y su PVC local es de 10 GiB. Para despliegues compartidos hay que separar los backends, usar Mimir y almacenamiento de objetos, y completar autenticación, TLS, retención, alertas y respaldos.

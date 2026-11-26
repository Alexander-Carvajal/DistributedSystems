# Fase 2: cargas de Kubernetes en la laptop

El laboratorio usa un único nodo k3d con 8 GB asignados a Docker Desktop. Los tres pods de Galera, los dos de Redis y Sentinel comparten ese nodo: prueban la topología lógica, pero una falla de la laptop afecta a todos. El almacenamiento `local-path` es persistente mientras se conserva el clúster; no es almacenamiento distribuido.

## Componentes

| Componente | Configuración de desarrollo |
| --- | --- |
| Entrada | Traefik en `http://127.0.0.1:8081/` |
| Web | Deployment, Service, Ingress, HPA 1–2, PDB, sondas, límites y NetworkPolicy |
| API | Deployment, Service, HPA 1–2, PDB, sondas y NetworkPolicy |
| MariaDB | `mariadb-operator` 26.10.2, Galera de 3 pods, PVC de 2 GiB por pod, base y usuario creados por CRD |
| MongoDB | `mongodb-kubernetes` 1.16.0, replica set Community de 1 miembro con PVC |
| Redis | `redis-operator` 0.27.0, 2 pods y 1 Sentinel con PVC |
| RabbitMQ | Cluster Operator 2.23.0 instalado; el clúster y las colas se crean en la fase 3 |
| Certificados internos | `cert-manager` v1.21.3, requerido por RabbitMQ Cluster Operator |

Las imágenes de web y API usan etiquetas locales de laboratorio y `imagePullPolicy: Never`. GHCR y etiquetas por commit llegan en la fase 4.
El `worker` se añade en la fase 3, cuando existan las colas y su código.

## Verificación del 24 de noviembre de 2026

- Galera `3/3`, MongoDB `1/1`, Redis `2/2`, Sentinel `1/1`, RabbitMQ Operator `1/1` y API `1/1`.
- El Job `store-catalog-init` terminó y registró la creación del esquema SQL y las reseñas de ejemplo.
- `/`, `/catalog.js`, `/api/healthz`, `/api/readyz`, `/api/health`, `/api/products/cheapest` y la lectura de reseñas respondieron HTTP 200.
- La API escribió y leyó una reseña de prueba a través de Ingress; después se borró y quedó la única reseña de ejemplo original.
- Los HPA de web y API recibieron métricas de CPU. El nodo utilizó 3680 MiB de 8 GiB asignados y la unidad C: tenía cerca de 54,7 GiB libres.

## Secretos

`scripts/setup-phase2-secrets.ps1` toma las contraseñas del archivo local `.env` e instala cinco Secret en `store-data` y `store-application`. No imprime valores ni los guarda en Git. Para el flujo GitOps actual, estos Secrets están versionados cifrados con SOPS; vuelve a instalar la clave age en `flux-system` al recrear el clúster, como explica [seguridad local](../deploy/platform/security/README.md).

```powershell
./scripts/setup-phase2-secrets.ps1
```

Los datos de Compose no se copian automáticamente. El Job de catálogo usa el SQL y las reseñas de ejemplo incluidos en la imagen API; los volúmenes de Compose permanecen intactos.

## Despliegue local

Tras crear el clúster y las namespaces de la fase 1:

```powershell
$env:KUBECONFIG = (Resolve-Path .tools/kubeconfig).Path
docker build -t store-web-site1:phase2 --build-arg SITE=site1 ./web
docker build -t store-api:phase2 ./application
.\.tools\k3d.exe image import store-web-site1:phase2 store-api:phase2 --cluster distributed-lab --mode direct
./scripts/setup-phase2-secrets.ps1

kubectl apply -k deploy/platform/cert-manager
kubectl wait helmrelease/cert-manager -n flux-system --for=condition=Ready --timeout=20m
kubectl apply -k deploy/platform/operators
kubectl wait helmrelease/mariadb-operator -n flux-system --for=condition=Ready --timeout=20m
kubectl wait helmrelease/mongodb-kubernetes -n flux-system --for=condition=Ready --timeout=20m
kubectl wait helmrelease/redis-operator -n flux-system --for=condition=Ready --timeout=20m
kubectl apply -k deploy/platform/rabbitmq-operator
kubectl apply -k deploy/overlays/dev/data
kubectl rollout status statefulset/store-mariadb -n store-data --timeout=20m
kubectl rollout status statefulset/store-mongodb -n store-data --timeout=40m
kubectl rollout status statefulset/store-redis -n store-data --timeout=20m
kubectl rollout status statefulset/store-redis-sentinel -n store-data --timeout=20m
kubectl apply -k deploy/overlays/dev/catalog-init
kubectl wait job/store-catalog-init -n store-application --for=condition=Complete --timeout=10m
kubectl apply -k deploy/overlays/dev/api
kubectl apply -k deploy/overlays/dev/web
kubectl rollout status deployment/store-api -n store-application --timeout=10m
kubectl rollout status deployment/store-web -n store-web --timeout=10m
```

Al publicar estos cambios en `main`, Flux seguirá el orden `operadores → datos → catálogo → API` y reconciliará la web. El operador RabbitMQ depende por separado de cert-manager. Las imágenes y los secretos locales deben existir antes de activar el camino GitOps.

La NetworkPolicy de MongoDB permite al agente consultar el API server en `10.43.0.1:443` y en el backend actual `172.18.0.3:6443`. kube-proxy traduce el Service a ese backend. Si se recrea el clúster y cambia la IP interna del nodo, consultar `kubectl get endpoints kubernetes -n default` y actualizar el `/32` en `deploy/overlays/dev/data/network-policy.yaml` antes de aplicar el overlay. El primer arranque puede tardar más de 20 minutos por las descargas de MongoDB.

## Límites del laboratorio

- No hay tolerancia a pérdida de nodo: Galera, Redis, web y API comparten la misma laptop. Los PDB restringen drenajes voluntarios, no protegen contra apagado del equipo.
- No se instala MetalLB: el puerto local de k3d y Traefik sustituyen el VIP en esta variante. MetalLB aplica a un clúster bare metal con una red que pueda anunciar su IP.
- La inicialización crea datos de ejemplo; la migración de los datos de Compose, la copia de seguridad y la restauración forman parte del corte de la fase 8.
- No se activa un overlay `prod` sin un clúster de producción ni imágenes publicadas.

Fuentes: [plan original](https://github.com/tuxtter/distributedsystems/blob/main/PLATFORM-MIGRATION-PLAN.md), [mariadb-operator](https://github.com/mariadb-operator/mariadb-operator), [MongoDB Kubernetes Operator](https://github.com/mongodb/mongodb-kubernetes), [Redis Operator](https://github.com/OT-CONTAINER-KIT/redis-operator), [RabbitMQ Cluster Operator](https://www.rabbitmq.com/kubernetes/operator/install-operator).

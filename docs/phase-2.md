# Fase 2: cargas Kubernetes en el laboratorio local

## Estado comprobado (24 de noviembre de 2026)

- La web se desplegó desde `deploy/overlays/dev/web` en `store-web`. Traefik la publica en `http://127.0.0.1:8081/`; `/` y `/catalog.js` respondieron HTTP 200.
- El Deployment usa una imagen local sin privilegios, un Service, Ingress, sondas HTTP, solicitudes y límites de recursos, HPA, PodDisruptionBudget y una regla de distribución suave por nodo. El HPA recibió métricas de CPU.
- `store-web` tiene una NetworkPolicy de denegación predeterminada y permisos explícitos para tráfico desde Traefik, DNS y la futura API. Después de aplicar las políticas, el pod se reinició y la web volvió a responder HTTP 200.
- Existe un Service `store-api` sin endpoints. Hasta desplegar la API y sus dependencias, `/api/*` devuelve un error tras un tiempo de conexión limitado; la web estática continúa disponible.
- `deploy/overlays/dev/api` genera un Deployment, ConfigMap, HPA y PodDisruptionBudget de API válidos en una prueba `kubectl apply --dry-run=server`, pero todavía no se aplicó. La API necesita secretos y servicios de datos Kubernetes reales.
- Los volúmenes de Docker Compose permanecen intactos. Esta fase no ha migrado datos de MariaDB ni MongoDB.

## Uso de imágenes locales

La imagen `store-web-site1:phase2` se construyó e importó al nodo k3d. En una recreación del clúster, volver a importar antes de aplicar los manifiestos:

```powershell
docker build -t store-web-site1:phase2 --build-arg SITE=site1 ./web
.\.tools\k3d.exe image import store-web-site1:phase2 --cluster distributed-lab --mode direct
$env:KUBECONFIG = (Resolve-Path .tools/kubeconfig).Path
kubectl apply -k deploy/overlays/dev/web
```

`clusters/dev/web.yaml` prepara a Flux para reconciliar la web desde Git una vez publicado este cambio. La publicación de imágenes en GHCR y sus etiquetas por commit corresponden a la fase 4.

## Trabajo que falta en la fase 2

1. Elegir y desplegar el nivel de datos en Kubernetes con límites que quepan en los 8 GB asignados a Docker Desktop. El plan original requiere operadores de MariaDB Galera y MongoDB, Redis Sentinel/operator, almacenamiento persistente y pruebas de recuperación. La variante de un nodo local no proporciona alta disponibilidad física.
2. Ajustar los nombres de servicios del `store-api-config` a los que creen los operadores, crear los secretos en Kubernetes sin guardarlos en Git y ejecutar la inicialización del catálogo.
3. Importar la imagen de API, aplicar `deploy/overlays/dev/api`, validar `/healthz`, `/readyz`, catálogo y reseñas por Ingress, y añadir NetworkPolicies para API y datos.
4. Definir imágenes publicadas y un overlay de producción cuando exista un destino de producción. El almacenamiento local de k3d no sustituye un backend distribuido.

El repositorio `mongodb/mongodb-kubernetes-operator` indicado por muchos ejemplos antiguos está [deprecado](https://github.com/mongodb/mongodb-kubernetes-operator); MongoDB dirige las instalaciones nuevas a [`mongodb/mongodb-kubernetes`](https://github.com/mongodb/mongodb-kubernetes). Hay que usar la documentación y CRDs del operador actual antes de crear los recursos de datos.

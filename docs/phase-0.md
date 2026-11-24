# Fase 0: preparación de imágenes y configuración

Esta fase prepara la aplicación para Kubernetes sin desplegar todavía K3s. Docker Compose sigue siendo el entorno local.

## Decisiones

- Registro de imágenes: GitHub Container Registry (`ghcr.io`).
- Imágenes propias: `store-api`, `store-web-site1`, `store-web-site2` y `store-web-site3`.
- Etiquetas al publicar: `sha-<commit>` como identificador inmutable y SemVer (`vX.Y.Z`) para entregas. No usar `latest` en despliegues.
- La API recibe conexión a MariaDB, MongoDB y Redis por variables de entorno. `PORT` permite configurar el puerto de escucha; su valor predeterminado es `8080`.
- La imagen web escucha en `8080` como usuario sin privilegios. `API_UPSTREAM` define el destino de `/api/`; en la imagen su valor local predeterminado es `http://application-lb-master:8080`.

## Requisitos para esta fase

- Docker Desktop con motor Linux y Docker Compose v2 en funcionamiento.
- Acceso a Internet para descargar imágenes base y paquetes npm.
- Git para identificar el commit que se usará en la etiqueta `sha-<commit>`.
- No hace falta instalar K3s, Terraform, Helm ni Flux para construir las imágenes de esta fase.

## Construir las imágenes

Desde la raíz del repositorio:

```powershell
docker build -t store-api:phase0 ./application
docker build -t store-web-site1:phase0 --build-arg SITE=site1 ./web
docker build -t store-web-site2:phase0 --build-arg SITE=site2 ./web
docker build -t store-web-site3:phase0 --build-arg SITE=site3 ./web
```

En las imágenes web, configurar `API_UPSTREAM` con la dirección del Service de la API al desplegar en Kubernetes. Las imágenes no contienen contraseñas ni archivos `.env`.

## Comprobaciones de la API

- `GET /healthz`: proceso HTTP vivo; no consulta dependencias.
- `GET /readyz`: MariaDB y MongoDB responden; Redis es una caché opcional.
- `GET /health`: diagnóstico existente con estado de Redis, conservado para Compose y Nagios.

Los probes de Kubernetes deberán apuntar a `/healthz` y `/readyz` en la fase 2. Antes de publicar en GHCR, construir y probar las cuatro imágenes con Docker activo y verificar que el sitio responde y que la API usa las variables esperadas. La publicación automatizada se implementará en la fase 4.

## Validación local (23 de noviembre de 2026)

- Las cuatro imágenes se construyeron correctamente en Docker Desktop.
- La imagen web de `site1` respondió HTTP 200 en `/` al ejecutarse con `API_UPSTREAM` configurado a una dirección resoluble. Las imágenes de `site2` y `site3` se construyeron, pero no se ejecutaron.
- Las imágenes declaran usuarios sin privilegios (`node` para la API y UID 101 para Nginx).
- `docker compose config --quiet` y `node --check application/index.js` finalizaron sin errores.
- Se inició `app1` con sus dependencias existentes y se comprobó HTTP 200 en `/healthz`, `/readyz`, `/health` y `/products/cheapest`. Después se ejecutó `docker compose down` sin `-v`, conservando los volúmenes de datos.

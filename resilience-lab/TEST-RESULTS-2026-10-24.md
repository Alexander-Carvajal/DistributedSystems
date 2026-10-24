# Resultados de pruebas PoC — 24 de octubre de 2026

## Alcance y entorno

Se inició `resilience-lab` junto con la pila principal. El dashboard quedó disponible en [http://localhost:8090](http://localhost:8090). Las herramientas (ApacheBench, JMeter y Chaos Monkey) corrieron dentro de sus contenedores; no se instalaron programas adicionales en Windows.

Las corridas se hicieron en Docker Desktop sobre una sola laptop. Son pruebas funcionales y de carga breves, útiles para demostrar el comportamiento del laboratorio, pero no constituyen una prueba de capacidad de producción ni de SLA.

## 1. Línea base y funcionalidad

| Comprobación | Resultado |
|---|---|
| `GET /api/health` | HTTP 200; `status=ok`, caché disponible |
| Rotación de presentación | En nueve solicitudes se observaron `webnode1`, `webnode2` y `webnode3` en secuencia repetida |
| Rotación de aplicación | Las trazas mostraron `app1`, `app2` y `app3` en secuencia repetida |
| HAProxy de presentación | Las nueve trazas indicaron `presentation-lb-master` |
| Galera | `wsrep_cluster_size=3`, estado `Primary` |
| Replicación de escritura | Se insertó una fila temporal por `galera1`; `galera2` y `galera3` leyeron el mismo ID. La tabla de prueba se eliminó después |
| Servicios | Los tres nodos web, de aplicación, MongoDB y Galera aparecieron saludables; Redis primario/réplica y Sentinels operaron y la API reportó caché disponible |

La alternancia de presentación y aplicación fue observada mediante la cabecera de traza `X-Request-Trace`; el nombre del balanceador de presentación permaneció en el master mientras estaba sano.

No se inspeccionó directamente la interfaz de red para confirmar la dirección VIP; la traza confirma el balanceador que atendió las solicitudes, no la propiedad de la VIP.

## 2. Rendimiento

Se ejecutaron pruebas pequeñas para no saturar la laptop:

| Herramienta y escenario | Configuración | Resultado |
|---|---|---|
| ApacheBench, smoke | 100 solicitudes a `/api/health`, concurrencia 5 | 100 completadas; 0 fallidas; 0 respuestas no 2xx; 415.98 req/s; media 12.02 ms; p95 32 ms; p99 35 ms |
| JMeter, smoke | 5 usuarios, 15 s, rutas `/api/health` y `/api/products/cheapest` | 632 muestras; 0 errores; 42.70 req/s; media 7.8 ms; p95 12 ms; p99 16 ms; máximo 44 ms |
| ApacheBench, carga corta | 2,000 solicitudes a `/api/products/cheapest`, concurrencia 20 | 2,000 completadas; 0 fallidas; 0 no 2xx; 1,252.01 req/s; media 15.97 ms; p95 35 ms; p99 52 ms |
| JMeter con Chaos Monkey | 20 usuarios, rampa 5 s, duración 35 s, rutas de salud y catálogo | 2,493 muestras; 0 errores HTTP; 71.65 req/s; p50 6 ms; p95 15 ms; p99 7,028 ms; máximo 7,066 ms |

El p99 elevado de JMeter durante el experimento combinado refleja una solicitud con demora de unos 7 s, aunque no terminó como error HTTP. El p95 de ApacheBench en la carga corta quedó por debajo del objetivo ilustrativo de 200 ms de `TEST-PLAN.md`; el p99 de la ejecución combinada no lo cumplió.

Estas duraciones no cubren las pruebas de carga de 10–30 minutos ni la prueba soak de horas que recomienda `TEST-PLAN.md`. No se ejecutaron spike, stress hasta saturación ni comparación cache fría/caliente.

**Artefactos:** [ApacheBench smoke](http://localhost:8090/files/20261024-231716-90a7/console.log), [JMeter smoke HTML](http://localhost:8090/files/20261024-231759-8e39/report/index.html), [ApacheBench carga](http://localhost:8090/files/20261024-231845-b153/console.log), [JMeter bajo caos HTML](http://localhost:8090/files/20261024-232002-7529/report/index.html).

Hubo dos intentos preliminares fallidos que no se incluyen en las métricas exitosas: ApacheBench no pudo iniciar antes de normalizar los finales de línea del script dentro del contenedor; el primer JMeter recibió las dos rutas como una sola ruta literal por un salto de línea mal escapado. Después de corregir el entorno de ejecución y el parámetro, los smoke tests de la tabla terminaron sin errores.

## 3. Alta disponibilidad y failover

Se detuvo temporalmente `galera2` mientras se hicieron 20 solicitudes a `/api/health` con pausas de 400 ms. Las 20 devolvieron HTTP 200. Tras volver a iniciar `galera2`, los tres nodos quedaron saludables y Galera informó tamaño 3 y estado `Primary`.

Esto verifica la continuidad ante la caída de un nodo de base de datos con la topología actual y el proxy `database-proxy`. No se detuvieron los dos balanceadores de una misma capa ni se probó el movimiento de VIP del master al backup; esos escenarios quedan pendientes.

## 4. Chaos Engineering con Chaos Monkey

Primero se hizo un dry run. Chaos Monkey encontró el grupo `web` (`web1`, `web2`, `web3`), simuló una parada y restauración sin afectar contenedores; obtuvo 11/11 probes exitosos.

Después se ejecutó `stop` sobre un máximo de un nodo web a la vez, durante 26 s, mientras JMeter generaba carga. Las fallas duraron aproximadamente 5–6 s:

| Tiempo aproximado | Servicio detenido | Restauración |
|---:|---|---:|
| 3.8 s | `web1` | 10.2 s |
| 12.9 s | `web3` | 19.3 s |
| 21.8 s | `web1` | 26.8 s |

Chaos Monkey registró 29 probes: 28 exitosos y 1 fallido (96.55% de disponibilidad en esta ventana corta). La solicitud fallida agotó el timeout de 3 s; el máximo tiempo de respuesta entre probes exitosos fue aproximadamente 2 s. JMeter registró 0 errores HTTP en sus 2,493 muestras, con un outlier de alrededor de 7 s. El experimento restauró automáticamente los nodos; después, los tres web y la API estaban arriba y `/api/health` volvió a responder con caché disponible.

**Artefactos:** [Chaos Monkey dry run](http://localhost:8090/files/20261024-231936-e801/console.log), [resumen de Chaos Monkey bajo carga](http://localhost:8090/files/20261024-232002-7b3a/summary.json), [log de Chaos Monkey](http://localhost:8090/files/20261024-232002-7b3a/console.log).

## 5. Observabilidad y alertas

Los logs de Chaos Monkey guardaron acción, servicio y tiempos; el dashboard conserva las salidas y reportes JMeter en su volumen `results`. La prueba combinada detectó una sonda fallida que no apareció como error HTTP en JMeter, así que ambas señales aportan información distinta.

Nagios está accesible en el puerto `8088`, pero su configuración actual no representa la topología de esta pila: el log registró alertas `CRITICAL/DOWN` para hosts llamados `mongodb` y `redis` con `Invalid hostname`, aunque los nuevos servicios son `mongodb1`–`mongodb3` y `redis-primary`/`redis-replica`. También aparecen advertencias de hosts sin contactos/contact groups. Por tanto, **Nagios no sirve todavía como evidencia confiable de alertas de estas pruebas**; requiere configuración para los nombres de servicio actuales y destinos de notificación. No se modificó esa configuración porque el requisito limita los cambios a este archivo Markdown nuevo.

No se midieron formalmente MTTD, MTTR ni consumo de CPU/memoria por experimento. Para ello haría falta alinear los intervalos de check, logs y métricas de contenedor en una corrida más larga.

## Hallazgos sobre el laboratorio

- Los scripts del laboratorio tienen finales de línea de Windows. En esta sesión normalicé las copias dentro de los contenedores para poder ejecutarlos; no edité los scripts versionados. Al reconstruir los contenedores, puede ser necesario repetir la normalización, o convertir esos scripts a LF en un cambio posterior.
- La configuración de Nagios y algunas opciones de Chaos Monkey todavía mencionan los servicios antiguos `mongodb` y `redis`. La prueba de Chaos se limitó al grupo `web`, cuyo mapeo sí coincide con Compose.
- Se hicieron pruebas breves de smoke, carga corta, failover Galera y caos en web. Permanecen pendientes: fallos de aplicación y balanceadores, failover VIP, fallas MongoDB/Redis con el mapeo actualizado, doble falla por capa, red/recursos, spike, stress, soak y alertas Nagios corregidas.
- Los resultados de esta laptop no predicen rendimiento en varias máquinas: todos los contenedores comparten host y recursos.

## Estado al finalizar

El laboratorio quedó iniciado en `http://localhost:8090`; la pila principal también quedó activa. Galera reportó tres nodos en `Primary`, los nodos web se restauraron y `/api/health` respondió `ok` con caché disponible.

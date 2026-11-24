# Fase 1: laboratorio K3s en la laptop

El plan original propone tres nodos K3s en máquinas virtuales con Terraform. Este laboratorio usa k3d, que ejecuta K3s en contenedores Docker, para ajustarse a una laptop con 16 GB de RAM. Los nodos comparten Docker Desktop, el disco y el equipo físico; no proporcionan alta disponibilidad frente a una falla de la laptop.

## Estado actual

- k3d v5.9.0 está instalado en `.tools/k3d.exe` (ignorado por Git). Su SHA-256 se verificó contra el publicado en el [release oficial](https://github.com/k3d-io/k3d/releases/tag/v5.9.0).
- El clúster `distributed-lab` se creó desde `infra/k3d/lab.yaml` con un servidor K3s v1.35.10+k3s1 y ningún agente.
- La API de Kubernetes está enlazada solo a `127.0.0.1:6445`. El balanceador expone el puerto HTTP `127.0.0.1:8081` para futuros Ingress.
- El kubeconfig local está en `.tools/kubeconfig`; no se modificó el kubeconfig global del usuario.
- El nodo, CoreDNS, almacenamiento local, metrics-server y Traefik se comprobaron como listos el 23 de noviembre de 2026.
- Con solo los componentes base, el nodo consumía aproximadamente 710 MiB de RAM. Docker Desktop tiene asignados unos 8 GB; este valor crecerá al desplegar la aplicación.
- Terraform v1.17.1 está instalado en `.tools/terraform/terraform.exe`. El entorno `infra/terraform/envs/dev` usa estado local ignorado por Git y administra cinco namespaces. `terraform validate` pasó y un segundo `plan` no mostró cambios.
- Los cuatro controladores de Flux v2.10.1 están listos. El `GitRepository` público `flux-system` lee `main` sin credenciales. El 24 de noviembre de 2026 se aplicó `clusters/dev/flux-system/sync.yaml`: la Kustomization quedó `Ready` y reconcilió el commit de fusión del PR #3 (`c5617a9`).
- `terraform fmt`, `terraform validate`, TFLint y Checkov finalizaron sin hallazgos en la configuración local. El flujo de GitHub Actions del PR #3 también terminó correctamente.

## Uso desde PowerShell

Desde la raíz del repositorio:

```powershell
$env:KUBECONFIG = (Resolve-Path .tools/kubeconfig).Path
kubectl get nodes
kubectl get pods -A
```

Para detener el clúster sin borrar su configuración ni sus datos:

```powershell
.\.tools\k3d.exe cluster stop distributed-lab
```

Para volver a iniciarlo:

```powershell
.\.tools\k3d.exe cluster start distributed-lab
```

Para revisar la infraestructura del laboratorio:

```powershell
.\.tools\terraform\terraform.exe -chdir=infra/terraform/envs/dev plan
.\.tools\flux\flux.exe check
kubectl get gitrepository -n flux-system
```

La reconciliación ya está activa. Para comprobar su estado o restaurarla tras crear de nuevo el clúster:

```powershell
kubectl apply -f clusters/dev/flux-system/sync.yaml
kubectl get kustomizations -n flux-system
```

El flujo `.github/workflows/terraform.yml` ejecuta `fmt`, `validate`, TFLint y Checkov en PRs y cambios de Terraform en `main`.

Si se trabaja desde otra copia del repositorio, descargar `k3d-windows-amd64.exe` del release v5.9.0 a `.tools/k3d.exe`, verificar que su SHA-256 es `49d0b9c796f5b8ba6f58a1dd5469e8b7b34bf9b6ce9078633eedb2789680a034`, y crear el clúster con:

```powershell
.\.tools\k3d.exe cluster create --config infra/k3d/lab.yaml
.\.tools\k3d.exe kubeconfig get distributed-lab | Set-Content -Encoding utf8 .tools/kubeconfig
```

## Siguiente trabajo de la fase 1

- Medir el consumo de RAM y disco al desplegar cargas representativas antes de probar tres servidores.
- La instalación local usa el CLI oficial de Flux y lectura pública de Git; no usa `flux_bootstrap_git`, porque este requeriría credenciales de escritura con estado de Terraform guardado en la laptop.
- El estado remoto con bloqueo y el entorno `prod` del plan original requieren un destino externo. Se posponen mientras el proyecto sea exclusivamente un laboratorio local.
- La red, los nodos y el almacenamiento `local-path` los administra k3d/K3s mediante `infra/k3d/lab.yaml`; Terraform administra los namespaces. No se trasladó el ciclo de vida de k3d a un proveedor comunitario de Terraform.

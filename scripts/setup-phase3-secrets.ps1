param(
    [string]$Kubeconfig = ".tools/kubeconfig"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Kubeconfig)) {
    throw "No se encontró el kubeconfig: $Kubeconfig"
}

$env:KUBECONFIG = (Resolve-Path -LiteralPath $Kubeconfig).Path
$source = & kubectl get secret store-queue-default-user --namespace store-queue -o json
if ($LASTEXITCODE -ne 0) { throw "RabbitMQ aún no creó store-queue-default-user" }
$sourceSecret = $source | ConvertFrom-Json
if (-not $sourceSecret.data.username -or -not $sourceSecret.data.password) {
    throw "El secreto de RabbitMQ no contiene las claves username/password esperadas"
}

$manifest = @"
apiVersion: v1
kind: Secret
metadata:
  name: store-queue-credentials
  namespace: store-application
type: Opaque
data:
  username: $($sourceSecret.data.username)
  password: $($sourceSecret.data.password)
"@
$manifest | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw "No se pudieron sincronizar las credenciales de RabbitMQ" }

Write-Output "Credenciales de RabbitMQ sincronizadas en store-application."

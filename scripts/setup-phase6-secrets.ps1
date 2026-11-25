param(
    [string]$Kubeconfig = ".tools/kubeconfig",
    [string]$EnvironmentFile = ".env"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Kubeconfig)) {
    throw "No se encontró el kubeconfig: $Kubeconfig"
}
if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
    throw "No se encontró el archivo de entorno: $EnvironmentFile"
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $value = $matches[2].Trim()
        if ($value.Length -ge 2 -and $value[0] -eq $value[-1] -and $value[0] -in @("'", '"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$matches[1]] = $value
    }
}

if (-not $values.ContainsKey("GRAFANA_ADMIN_PASSWORD") -or $values.GRAFANA_ADMIN_PASSWORD.Length -lt 16) {
    throw "Define GRAFANA_ADMIN_PASSWORD con al menos 16 caracteres en $EnvironmentFile"
}

$env:KUBECONFIG = (Resolve-Path -LiteralPath $Kubeconfig).Path
$namespace = & kubectl create namespace observability --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw "No se pudo generar el namespace observability" }
$namespace | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el namespace observability" }

$secret = & kubectl create secret generic grafana-credentials `
    --namespace observability `
    --from-literal=admin-password=$values.GRAFANA_ADMIN_PASSWORD `
    --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw "No se pudo generar el secreto de Grafana" }
$secret | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el secreto de Grafana" }

Write-Output "Secreto grafana-credentials aplicado en observability."

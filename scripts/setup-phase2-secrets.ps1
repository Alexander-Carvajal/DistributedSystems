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

$env:KUBECONFIG = (Resolve-Path -LiteralPath $Kubeconfig).Path
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

$required = @(
    "MARIADB_ROOT_PASSWORD", "CATALOG_DB_PASSWORD",
    "MONGO_APP_PASSWORD", "REDIS_PASSWORD"
)
foreach ($name in $required) {
    if (-not $values.ContainsKey($name) -or [string]::IsNullOrEmpty($values[$name])) {
        throw "Falta $name en $EnvironmentFile"
    }
}

function Set-KubernetesSecret {
    param(
        [string]$Namespace,
        [string]$Name,
        [hashtable]$Entries
    )
    $arguments = @("create", "secret", "generic", $Name, "-n", $Namespace, "--dry-run=client", "-o", "yaml")
    foreach ($key in $Entries.Keys) {
        $arguments += "--from-literal=$key=$($Entries[$key])"
    }
    $manifest = & kubectl @arguments
    if ($LASTEXITCODE -ne 0) { throw "No se pudo generar el secreto $Name" }
    $manifest | & kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el secreto $Name" }
}

Set-KubernetesSecret store-data store-mariadb-root @{password = $values.MARIADB_ROOT_PASSWORD}
Set-KubernetesSecret store-data store-mariadb-user @{password = $values.CATALOG_DB_PASSWORD}
Set-KubernetesSecret store-data store-mongodb-user @{password = $values.MONGO_APP_PASSWORD}
Set-KubernetesSecret store-data store-redis-secret @{password = $values.REDIS_PASSWORD}
Set-KubernetesSecret store-application store-api-credentials @{
    DB_PASSWORD = $values.CATALOG_DB_PASSWORD
    MONGO_PASSWORD = $values.MONGO_APP_PASSWORD
    REDIS_PASSWORD = $values.REDIS_PASSWORD
}

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]([-a-z0-9]*[a-z0-9])?$')]
    [string]$Namespace,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]([-a-z0-9]*[a-z0-9])?$')]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [string]$Kubeconfig = ".tools/kubeconfig",
    [string]$AgeKeyFile = ".tools/sops/age/keys.txt",
    [string]$AgeRecipient = "age14gjudzk2v9pga3ymyfl0aryvjzkmr2y6l096f3rgk3n8jdlss59q4srw8n",
    [string]$SopsPath = "sops"
)

$ErrorActionPreference = 'Stop'

foreach ($path in @($Kubeconfig, $AgeKeyFile)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "No se encontró el archivo requerido: $path"
    }
}

$resolvedKubeconfig = (Resolve-Path -LiteralPath $Kubeconfig).Path
$resolvedAgeKey = (Resolve-Path -LiteralPath $AgeKeyFile).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$rawSecret = & kubectl --kubeconfig $resolvedKubeconfig get secret $Name --namespace $Namespace -o json
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo leer el Secret $Namespace/$Name."
}
$source = ($rawSecret -join "`n") | ConvertFrom-Json
if (-not $source.data) {
    throw "El Secret $Namespace/$Name no contiene datos para cifrar."
}

$minimalSecret = [ordered]@{
    apiVersion = 'v1'
    kind       = 'Secret'
    metadata   = [ordered]@{
        name      = $source.metadata.name
        namespace = $source.metadata.namespace
    }
    type       = $source.type
    data       = $source.data
}
$json = $minimalSecret | ConvertTo-Json -Depth 10 -Compress
$sopsArgs = @(
	'encrypt',
	'--filename-override', $resolvedOutput,
    '--age', $AgeRecipient,
    '--encrypted-regex', '^(data|stringData)$',
    '--input-type', 'json',
    '--output-type', 'yaml'
)
$encrypted = ($json | & $SopsPath @sopsArgs) -join "`n"
if ($LASTEXITCODE -ne 0 -or -not $encrypted.Contains('ENC[AES256_GCM,')) {
    throw "SOPS no pudo cifrar el Secret $Namespace/$Name. No se escribió el archivo."
}

$oldIdentity = $env:SOPS_AGE_KEY_FILE
try {
    $env:SOPS_AGE_KEY_FILE = $resolvedAgeKey
    $roundTrip = ($encrypted | & $SopsPath decrypt --filename-override $resolvedOutput --input-type yaml --output-type json) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw 'No se pudo verificar el descifrado local con la clave age.'
    }
    $decoded = $roundTrip | ConvertFrom-Json
    foreach ($property in $source.data.PSObject.Properties) {
        if ($decoded.data.PSObject.Properties[$property.Name].Value -ne $property.Value) {
            throw "La verificación local de descifrado falló para $Namespace/$Name."
        }
    }
}
finally {
    if ($null -eq $oldIdentity) {
        Remove-Item Env:SOPS_AGE_KEY_FILE -ErrorAction SilentlyContinue
    }
    else {
        $env:SOPS_AGE_KEY_FILE = $oldIdentity
    }
    $rawSecret = $null
    $source = $null
    $minimalSecret = $null
    $json = $null
    $roundTrip = $null
    $decoded = $null
}

[System.IO.File]::WriteAllText(
    $resolvedOutput,
    $encrypted.TrimEnd() + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)
$encrypted = $null
Write-Output "Secret cifrado y verificado: $resolvedOutput"

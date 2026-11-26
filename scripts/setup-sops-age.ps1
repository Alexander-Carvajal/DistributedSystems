param(
    [string]$Kubeconfig = ".tools/kubeconfig",
    [string]$AgeKeyFile = ".tools/sops/age/keys.txt"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Kubeconfig)) {
    throw "No se encontró el kubeconfig: $Kubeconfig"
}
if (-not (Test-Path -LiteralPath $AgeKeyFile)) {
    throw "No se encontró la clave privada age local: $AgeKeyFile"
}

$resolvedKubeconfig = (Resolve-Path -LiteralPath $Kubeconfig).Path
$resolvedAgeKey = (Resolve-Path -LiteralPath $AgeKeyFile).Path
$manifest = & kubectl --kubeconfig $resolvedKubeconfig create secret generic sops-age `
    --namespace flux-system `
    --from-file="age.agekey=$resolvedAgeKey" `
    --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo preparar el Secret sops-age.'
}
$manifest | & kubectl --kubeconfig $resolvedKubeconfig apply -f -
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo aplicar el Secret sops-age en flux-system.'
}

Write-Output 'La clave age para Flux quedó instalada en flux-system/sops-age; su valor no se mostró.'

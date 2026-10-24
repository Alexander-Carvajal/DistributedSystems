$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$examplePath = Join-Path $repoRoot '.env.example'
$secretsPath = Join-Path $repoRoot 'secrets'
$keyPath = Join-Path $secretsPath 'mongodb-keyfile'

if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Host 'Created .env from .env.example. Review the local passwords before starting the stack.'
}

$envLines = [System.Collections.Generic.List[string]]::new()
$envLines.AddRange([string[]](Get-Content -LiteralPath $envPath))

function Set-GeneratedEnvValue([string]$Name, [string]$Value) {
    $pattern = '^' + [regex]::Escape($Name) + '='
    $index = -1
    for ($i = 0; $i -lt $envLines.Count; $i++) {
        if ($envLines[$i] -match $pattern) { $index = $i; break }
    }
    if ($index -ge 0) {
        if ($envLines[$index] -match '^' + [regex]::Escape($Name) + '=.+$' -and $envLines[$index] -notmatch 'change-this-') { return }
        $envLines[$index] = "$Name=$Value"
    } else {
        $envLines.Add("$Name=$Value")
    }
}

function New-SafePassword([int]$Length = 48) {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = [byte[]]::new($Length)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $chars = foreach ($byte in $bytes) { $alphabet[$byte % $alphabet.Length] }
    [Array]::Clear($bytes, 0, $bytes.Length)
    return -join $chars
}

Set-GeneratedEnvValue 'MONGO_APP_USERNAME' 'store_app'
Set-GeneratedEnvValue 'MONGO_APP_PASSWORD' (New-SafePassword)
Set-GeneratedEnvValue 'REDIS_PASSWORD' (New-SafePassword)
[System.IO.File]::WriteAllLines($envPath, $envLines, [System.Text.UTF8Encoding]::new($false))

New-Item -ItemType Directory -Force -Path $secretsPath | Out-Null
if (-not (Test-Path -LiteralPath $keyPath)) {
    $keyBytes = [byte[]]::new(512)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
    $key = [Convert]::ToBase64String($keyBytes)
    [Array]::Clear($keyBytes, 0, $keyBytes.Length)
    [System.IO.File]::WriteAllText($keyPath, $key, [System.Text.ASCIIEncoding]::new())
    Write-Host 'Created ignored local MongoDB replica-set key at secrets/mongodb-keyfile.'
} else {
    Write-Host 'Reusing local MongoDB replica-set key.'
}

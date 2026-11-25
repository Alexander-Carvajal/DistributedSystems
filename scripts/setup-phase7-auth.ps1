param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Username
)

$ErrorActionPreference = 'Stop'

$credential = Get-Credential -UserName $Username -Message 'Enter the password for the local Store site'
if ($null -eq $credential) {
    throw 'No credential was supplied.'
}

$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $hashLine = $plainPassword | docker run --rm -i httpd:2.4-alpine htpasswd -niB $Username
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($hashLine)) {
        throw 'Could not generate a password hash. Confirm Docker Desktop is running.'
    }

    $hashLine = ($hashLine | Select-Object -First 1).Trim()
    kubectl create secret generic store-web-auth `
        --namespace store-web `
        --from-literal "users=$hashLine" `
        --dry-run=client -o yaml | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create the store-web-auth Secret. Confirm the store-web namespace exists and kubectl uses the intended cluster.'
    }

    Write-Host 'The store-web-auth Secret is ready.'
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $plainPassword = $null
    $hashLine = $null
}

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Join-Path $env:ProgramData 'SCCC-DiagnosticsPublisher'
$config=Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
foreach($path in @($PSCommandPath,(Join-Path $root 'Export-AdDiagnosticsInventory.ps1'))){
    $signature=Get-AuthenticodeSignature -LiteralPath $path
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $config.signerThumbprint -or -not $signature.TimeStamperCertificate){throw 'Publisher startup signature validation failed.'}
}
& (Join-Path $root 'Export-AdDiagnosticsInventory.ps1') -SearchBase $config.searchBase `
    -OutputPath (Join-Path $root 'ad-inventory.json') -FredOrigin $config.fredOrigin `
    -PublishInventory -WorkerCredentialPath (Join-Path $root 'worker.dpapi')
if(-not $?){throw 'AD inventory publication failed.'}

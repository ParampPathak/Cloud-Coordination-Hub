param([string]$ImageTag = 'cloud-coordination-hub:release')
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required to prepare the offline release bundle. Install Docker Desktop first.' }
& npm run check
if ($LASTEXITCODE -ne 0) { throw 'Local verification failed.' }
New-Item -ItemType Directory -Path artifacts -Force | Out-Null
& docker build -t $ImageTag .
if ($LASTEXITCODE -ne 0) { throw 'Image build failed.' }
& docker save --output artifacts/cloud-hub-image.tar $ImageTag
if ($LASTEXITCODE -ne 0) { throw 'Image export failed.' }
Copy-Item -LiteralPath scripts/install-offline.sh -Destination artifacts/install-offline.sh
$digest = (Get-FileHash -LiteralPath artifacts/cloud-hub-image.tar -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath artifacts/cloud-hub-image.tar.sha256 -Value "$digest  cloud-hub-image.tar" -Encoding ascii
Write-Output 'Local release bundle prepared in artifacts/. Nothing was uploaded or deployed.'

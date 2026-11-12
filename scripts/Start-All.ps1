# Single entry point; all executable and data paths resolve from this file, never current directory.
# No secrets are accepted on command line, and no credentials are stored by this launcher.
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gateway = Join-Path $project 'components\gateway'
$ayu = Join-Path $project 'components\ayu'
$snow = Join-Path $project 'components\snowluma'
$logs = Join-Path $env:LOCALAPPDATA 'dsh-fish-soul-bridage\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $project 'VERSION') -Raw -Encoding UTF8).Trim()
function Node-Location {
  $bundled = Join-Path $snow 'node.exe'
  if (!(Test-Path -LiteralPath $bundled -PathType Leaf)) {
    throw 'Bundled SnowLuma/node.exe is missing. Download the Windows-Full ZIP, not a source archive.'
  }
  return $bundled
}
function Service-Ready([int]$port) {
  try {
    $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/health') -TimeoutSec 2 -UseBasicParsing
    $obj = $r.Content | ConvertFrom-Json
    return ($r.StatusCode -eq 200 -and $obj.ok -eq $true -and $obj.name -eq 'ayu-breezeblue-bridge')
  } catch { return $false }
}
function Start-Ayu([string]$node) {
  $port = 8765
  if ($env:BRIDGE_PORT -match '^\d+$') { $port = [int]$env:BRIDGE_PORT }
  if ($port -lt 1024 -or $port -gt 65535) { throw 'BRIDGE_PORT must be 1024..65535' }
  $entry = Join-Path $ayu 'bridge.mjs'
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    # Never kill a process that may belong to another application.
    if (Service-Ready $port) {
      Write-Host ('[OK] Ayu already listening at 127.0.0.1:' + $port)
      return
    }
    throw ('Port ' + $port + ' is occupied by a non-Ayu service; refusing to replace it.')
  }
  $env:BRIDGE_PORT = [string]$port
  $stdout = Join-Path $logs 'ayu.stdout.log'
  $stderr = Join-Path $logs 'ayu.stderr.log'
  $proc = Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $ayu `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  for ($i=0; $i -lt 40; $i++) {
    if ($proc.HasExited) { throw ('Ayu exited with code ' + $proc.ExitCode + '. Check ' + $stderr) }
    if (Service-Ready $port) { Write-Host ('[OK] Ayu TTS ready on 127.0.0.1:' + $port); return }
    Start-Sleep -Milliseconds 250
  }
  throw ('Ayu did not become healthy. Check ' + $stderr)
}
# All SnowLuma runtime files are tracked in components/snowluma.
# No previous installations, local CSS copying, downloads or external Node fallback.
foreach ($item in @('release.json','index.mjs','node.exe','client\logo.png',
                   'client\assets\overview-page-Bm3ks5zC.css',
                   'client\assets\index-DolPqBYW.vmo.js')) {
  if (!(Test-Path -LiteralPath (Join-Path $snow $item) -PathType Leaf)) {
    throw ('Incomplete bundled SnowLuma 2.4.2: missing ' + $item)
  }
}
$node = Node-Location
Write-Host ('[Start] dsh-fish-soul-bridage ' + $version)
Write-Host ('[Path]  ' + $project)
Write-Host ('[Node]  ' + $node)
if (!(Test-Path -LiteralPath (Join-Path $gateway 'deploy.ps1'))) { throw 'Gateway deploy.ps1 missing.' }
if (!(Test-Path -LiteralPath (Join-Path $ayu 'bridge.mjs'))) { throw 'Ayu bridge.mjs missing.' }
if ($CheckOnly) {
  Write-Host '[Check] Paths OK. No services started.'
  exit 0
}
$env:FS_BUNDLE_NODE = $node
$env:SNOWLUMA_DIR = $snow
# Safe to repeat: known SHA-256 builds only; unknown files never overwritten.
& $node (Join-Path $project 'scripts\Patch-SnowLuma-VMO.mjs') $snow
if ($LASTEXITCODE -ne 0) {
  throw 'Bundled SnowLuma v2.4.2 asset verification failed.'
}
if (-not $env:FS_CUSTOMER_MODELS_CONFIG) { $env:FS_CUSTOMER_MODELS_CONFIG = '1' }
if (-not $env:FS_CUSTOMER_DOUYIN_CONFIG) { $env:FS_CUSTOMER_DOUYIN_CONFIG = '1' }
if (-not $env:FS_CUSTOMER_SOCIAL_CONFIG) { $env:FS_CUSTOMER_SOCIAL_CONFIG = '1' }
if (-not $env:FS_CUSTOMER_BILI_AUTH) { $env:FS_CUSTOMER_BILI_AUTH = '1' }
if (-not $env:FS_CUSTOMER_DOUYIN_BROWSER) { $env:FS_CUSTOMER_DOUYIN_BROWSER = '1' }
$env:FS_CUSTOMER_DOUYIN_CUSTOM_BROWSER = '0'
# DSH Desktop and its fish-soul plugin are external prerequisites.
# The package contains neither DSH Desktop installer nor fish-soul .tgz.
# Gateway deploy.ps1 resolves the existing Desktop and manages the plugin if needed.
Start-Ayu $node
Write-Host '[Start] Starting DSH plugin installer, SnowLuma supervisor, and 56781 gateway.'
& (Join-Path $gateway 'deploy.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

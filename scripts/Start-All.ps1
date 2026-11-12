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
  $choices = @(
    (Join-Path $snow 'node.exe'),
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
    'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  )
  foreach ($choice in $choices) { if (Test-Path -LiteralPath $choice -PathType Leaf) { return $choice } }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'No Node.js executable found. Bundle SnowLuma/node.exe or install Node.js 22.5+.'
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
# Complete the bundled PATCHED SnowLuma overlay from an existing same-version,
# licensed local installation. Copy ONLY missing public client files, never
# configuration, credentials, private runtime state, or external files.
function Complete-SnowLuma-Assets {
  if ($env:SNOWLUMA_DIR) { return }  # explicit override wins
  $assetDir = Join-Path $snow 'client\assets'
  if (@(Get-ChildItem -LiteralPath $assetDir -Filter '*.css' -File -ErrorAction SilentlyContinue).Count -gt 0) { return }
  $candidates = @()
  if ($env:SNOWLUMA_COMPLETE_SOURCE) { $candidates += $env:SNOWLUMA_COMPLETE_SOURCE }
  $candidates += @('C:\dsh\SnowLuma')
  if (Test-Path -LiteralPath 'C:\dsh') {
    $candidates += @(Get-ChildItem -LiteralPath 'C:\dsh' -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^SnowLuma(?:[-_].*)?$' } |
      ForEach-Object { $_.FullName })
  }
  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (!(Test-Path -LiteralPath (Join-Path $candidate 'client\assets') -PathType Container)) { continue }
    if ($candidate.TrimEnd('\') -eq $snow.TrimEnd('\')) { continue }
    $existing = @(Get-ChildItem -LiteralPath (Join-Path $candidate 'client\assets') -Filter '*.css' -File -ErrorAction SilentlyContinue)
    if ($existing.Count -eq 0) { continue }
    try {
      $release = Get-Content -LiteralPath (Join-Path $candidate 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      if ([string]$release.version -ne '2.4.2') { continue }
      $sourceClient = Join-Path $candidate 'client'
      $targetClient = Join-Path $snow 'client'
      $prefix = $sourceClient.TrimEnd('\') + '\'
      $count = 0
      foreach ($file in @(Get-ChildItem -LiteralPath $sourceClient -File -Recurse -ErrorAction Stop)) {
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $relative = $file.FullName.Substring($prefix.Length)
        $target = Join-Path $targetClient $relative
        if (Test-Path -LiteralPath $target) { continue } # preserve patched JS and HTML
        $parent = Split-Path -Parent $target
        if (!(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $file.FullName -Destination $target -ErrorAction Stop
        $count++
      }
      if (@(Get-ChildItem -LiteralPath $assetDir -Filter '*.css' -File -ErrorAction SilentlyContinue).Count -gt 0) {
        Write-Host ('[OK] SnowLuma 2.4.2 overlay completed with '+$count+' missing client files from '+$candidate)
        return
      }
    } catch {
      Write-Warning ('Could not complete bundled SnowLuma assets: '+$_.Exception.GetType().Name)
    }
  }
  Write-Warning 'Bundled SnowLuma overlay still incomplete; an installed full SnowLuma version will be used if found.'
}
Complete-SnowLuma-Assets
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
# Caller overrides SNOWLUMA_DIR when an existing FULL installation is used.
# Bundled fix overlay may lack full CSS assets; deploy.ps1 will not start a partial WebUI.
# Prefer complete SnowLuma v2.4.2, including external installations.
if (-not $env:SNOWLUMA_DIR) {
  $sources = @($snow)
  if ($env:SNOWLUMA_COMPLETE_SOURCE) { $sources += $env:SNOWLUMA_COMPLETE_SOURCE }
  $sources += 'C:\dsh\SnowLuma'
  if (Test-Path -LiteralPath 'C:\dsh' -PathType Container) {
    $sources += @(Get-ChildItem -LiteralPath 'C:\dsh' -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^SnowLuma(?:[-_].*)?$' } | ForEach-Object { $_.FullName })
  }
  foreach ($candidate in @($sources | Select-Object -Unique)) {
    if (!(Test-Path -LiteralPath (Join-Path $candidate 'index.mjs') -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $candidate 'client\assets\overview-page-Bm3ks5zC.css') -PathType Leaf)) { continue }
    try {
      $rel = Get-Content -LiteralPath (Join-Path $candidate 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      if ([string]$rel.version -eq '2.4.2') { $env:SNOWLUMA_DIR = $candidate; break }
    } catch {}
  }
}
if (-not $env:SNOWLUMA_DIR) { $env:SNOWLUMA_DIR = $snow }
# Never rewrite an unknown build. All three assets must match known SHA-256.
$patchEntry = Join-Path $env:SNOWLUMA_DIR 'client\assets\index-DolPqBYW.vmo.js'
if (Test-Path -LiteralPath $patchEntry -PathType Leaf) {
  & $node (Join-Path $project 'scripts\Patch-SnowLuma-VMO.mjs') $env:SNOWLUMA_DIR
  if ($LASTEXITCODE -ne 0) { throw 'SnowLuma VMO patch preflight failed. Inspect the installed version before starting.' }
} else {
  Write-Warning 'Recognized SnowLuma VMO BasePath overlay not found; reverse proxy compatibility is unverified.'
}
if (-not $env:FS_CUSTOMER_MODELS_CONFIG) { $env:FS_CUSTOMER_MODELS_CONFIG = '1' }
if (-not $env:FS_CUSTOMER_DOUYIN_CONFIG) { $env:FS_CUSTOMER_DOUYIN_CONFIG = '1' }
if (-not $env:FS_CUSTOMER_SOCIAL_CONFIG) { $env:FS_CUSTOMER_SOCIAL_CONFIG = '1' }
if (-not $env:FS_CUSTOMER_BILI_AUTH) { $env:FS_CUSTOMER_BILI_AUTH = '1' }
if (-not $env:FS_CUSTOMER_DOUYIN_BROWSER) { $env:FS_CUSTOMER_DOUYIN_BROWSER = '1' }
$env:FS_CUSTOMER_DOUYIN_CUSTOM_BROWSER = '0'
Start-Ayu $node
Write-Host '[Start] Starting DSH plugin installer, SnowLuma supervisor, and 56781 gateway.'
& (Join-Path $gateway 'deploy.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

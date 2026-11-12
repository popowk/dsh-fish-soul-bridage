# DSH FishSoul V1.0.0 - idempotent, unattended launcher for Windows PowerShell 5.1.
# No interactive selection; a Windows UAC consent may still be required to change firewall rules.
param(
  [switch]$InstallOnly,
  [switch]$FirewallOnly,
  [switch]$SnowFirewallOnly,
  [int]$SnowPort = 5099,
  [string]$BindIP = '',
  [switch]$InstallCliPathOnly,
  [string]$CliPath = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$helperName = 'dsh-fish-soul-bridge-token'
$helperSource = Join-Path $root 'dsh-token-helper'
$helperHome = Join-Path $env:LOCALAPPDATA 'DSH-FishSoul-Gateway\bridge-token'
$authFile = Join-Path $env:LOCALAPPDATA 'DSH-fish-soul-bridge\host-auth.json'
$ruleName = 'DSH FishSoul LAN Gateway 56781 (scoped)'
$clientIP = '192.168.2.99'
$port = 56781
$logDir = Join-Path $env:LOCALAPPDATA 'DSH-FishSoul-Gateway\logs'
$installLog = Join-Path $logDir 'install-v100.log'
$script:desktopExeForRecovery = $null
$script:desktopWasStopped = $false
function Warn([string]$message) { Write-Host ('[WARN] ' + $message) -ForegroundColor Yellow }
function Info([string]$message) { Write-Host ('[INFO] ' + $message) -ForegroundColor Cyan }
function Good([string]$message) { Write-Host ('[ OK ] ' + $message) -ForegroundColor Green }
function IsPrivate([string]$ip) {
  return ($ip -match '^10\.(\d{1,3}\.){2}\d{1,3}$' -or
    $ip -match '^192\.168\.(\d{1,3}\.)\d{1,3}$' -or
    $ip -match '^172\.(1[6-9]|2[0-9]|3[01])\.(\d{1,3}\.)\d{1,3}$')
}
function Resolve-Node {
  $candidates = @()
  if ($env:FS_BUNDLE_NODE) { $candidates += $env:FS_BUNDLE_NODE }
  $candidates += @( 
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
    'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  )
  foreach ($f in $candidates) { if (Test-Path -LiteralPath $f) { return $f } }
  $found = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  throw 'Node.js was not found (DSH embedded node or system Node.js 22.5+ required).'
}
function Resolve-DSH {
  # The official Desktop CLI can manage the locked desktop profile. A generic
  # globally installed `dsh` may NOT have this permission. Prefer the bundled CLI.
  # Prefer the exact Desktop bundled CLI used on this Windows installation.
  $candidates = @('C:\dsh\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  $desktopExe = Desktop-Executable '' @(Desktop-Processes)
  if ($desktopExe) {
    $candidates += (Join-Path (Split-Path -Parent $desktopExe) 'resources\runtime\cli\bin\dsh.cmd')
  }
  foreach ($base in @('C:\dsh\DeepSeek Harness','C:\Program Files\DeepSeek Harness', (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'))) {
    $candidates += (Join-Path $base 'resources\runtime\cli\bin\dsh.cmd')
  }
  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) {
      Good ('Using bundled Desktop CLI: ' + $path)
      return $path
    }
  }
  foreach ($name in @('dsh.cmd','dsh.exe','dsh')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) {
      Warn ('Bundled CLI not found. Trying PATH CLI: ' + $cmd.Source)
      return $cmd.Source
    }
  }
  throw 'DSH Desktop CLI not found. Make sure DSH Desktop is installed and has been started at least once.'
}
function Desktop-Processes {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '^(DeepSeek Harness|DeepSeekHarness)\.exe$'
  })
}
function Desktop-Executable([string]$dshCli, [object[]]$running) {
  foreach ($proc in $running) {
    if ($proc.ExecutablePath -and (Test-Path -LiteralPath $proc.ExecutablePath)) { return $proc.ExecutablePath }
  }
  if ($dshCli) {
    $dir = Split-Path -Parent $dshCli
    for ($i=0; $i -lt 4; $i++) { $dir = Split-Path -Parent $dir }
    $candidate = Join-Path $dir 'DeepSeek Harness.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  foreach ($candidate in @(
    'C:\dsh\DeepSeek Harness\DeepSeek Harness.exe',
    'C:\Program Files\DeepSeek Harness\DeepSeek Harness.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe')
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}
# A DSH/Electron process can exit on its own between the CIM snapshot and
# taskkill.exe. taskkill then exits with 128 and writes a localized error to
# stderr. PowerShell 5.1 with ErrorActionPreference=Stop can otherwise treat
# that native stderr as a terminating exception. Do not use the native pipeline.
function Stop-DSHTreeSafely([int]$processId) {
  $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $processId) -ErrorAction SilentlyContinue
  if (!$current) {
    Info ('DSH PID ' + $processId + ' already exited; skipping.')
    return
  }
  # If the PID was recycled, never terminate a process that is not DSH.
  if ($current.Name -notmatch '^(DeepSeek Harness|DeepSeekHarness)\.exe$') {
    Warn ('DSH PID ' + $processId + ' now belongs to another process; skipping.')
    return
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  $psi.Arguments = '/PID ' + $processId + ' /T /F'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $killer = New-Object System.Diagnostics.Process
  $killer.StartInfo = $psi
  try {
    [void]$killer.Start()
    $finished = $killer.WaitForExit(10000)
    if (!$finished) {
      try { $killer.Kill() } catch {}
      Warn ('taskkill timed out for DSH PID ' + $processId + '; checking process state.')
    } elseif ($killer.ExitCode -ne 0) {
      # A nonzero exit can mean that an earlier /T killed this child already.
      $remaining = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $processId) -ErrorAction SilentlyContinue
      if (!$remaining) {
        Info ('DSH PID ' + $processId + ' exited during shutdown; continuing.')
      } elseif ($remaining.Name -match '^(DeepSeek Harness|DeepSeekHarness)\.exe$') {
        Warn ('taskkill reported exit ' + $killer.ExitCode + ' for PID ' + $processId + '; retrying DSH root only.')
        try { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  } catch {
    $remaining = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $processId) -ErrorAction SilentlyContinue
    if (!$remaining) {
      Info ('DSH PID ' + $processId + ' ended while stopping; continuing.')
    } else {
      Warn ('Could not stop DSH PID ' + $processId + ': ' + $_.Exception.Message)
    }
  } finally {
    $killer.Dispose()
  }
}
function Stop-DesktopGracefully([object[]]$running) {
  if ($running.Count -eq 0) { return }
  $script:desktopWasStopped = $true
  Info 'Plugin repair requires exclusive Desktop Profile access. Requesting normal shutdown.'
  foreach ($item in $running) {
    try {
      $proc = Get-Process -Id $item.ProcessId -ErrorAction Stop
      if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { [void]$proc.CloseMainWindow() }
    } catch {}
  }
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    if ((@(Desktop-Processes)).Count -eq 0) { Good 'DSH closed normally.'; return }
    Start-Sleep -Milliseconds 500
  }
  # Explicit user permission: terminate only DSH Desktop process trees.
  # Multiple Electron processes can vanish as the first tree is killed;
  # missing PIDs are harmless, NOT fatal installer errors.
  for ($pass=1; $pass -le 3; $pass++) {
    $roots = @(Desktop-Processes)
    if ($roots.Count -eq 0) { Good 'DSH Desktop processes stopped.'; Start-Sleep -Seconds 1; return }
    Warn ('DSH shutdown pass ' + $pass + ': stopping ' + $roots.Count + ' remaining DSH process tree(s).')
    foreach ($item in $roots) { Stop-DSHTreeSafely ([int]$item.ProcessId) }
    Start-Sleep -Seconds 1
  }
  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $deadline) {
    if ((@(Desktop-Processes)).Count -eq 0) { Good 'DSH Desktop process trees stopped.'; Start-Sleep -Seconds 1; return }
    Start-Sleep -Milliseconds 500
  }
  $remaining = @(Desktop-Processes | ForEach-Object { $_.ProcessId }) -join ','
  throw ('DSH Desktop still has running processes (' + $remaining + '). Installer will not change a potentially locked profile.')
}

function Select-InstallDSHHome {
  # DSH_HOME controls the profile path used by the Desktop bundled CLI.
  # Prefer the existing USERPROFILE spelling when pnpm was originally installed
  # through it, even when another alias (e.g. C:\dsh\.dsh) resolves to the same data.
  $defaultHome = Join-Path $env:USERPROFILE '.dsh'
  $defaultProfile = Join-Path $defaultHome 'profiles\desktop'
  $existingStore = Join-Path $defaultProfile 'node_modules\.pnpm'
  if (!(Test-Path -LiteralPath $defaultProfile -PathType Container)) {
    throw ('The existing DSH desktop profile is missing: ' + $defaultProfile)
  }
  $effectiveHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
  if ($effectiveHome -and ($effectiveHome.TrimEnd('\') -ine $defaultHome.TrimEnd('\'))) {
    $alternateManifest = Join-Path $effectiveHome 'profiles\desktop\package.json'
    $defaultManifest = Join-Path $defaultProfile 'package.json'
    # Never silently change between two independent Desktop profiles.
    if (!(Test-Path -LiteralPath $alternateManifest) -or !(Test-Path -LiteralPath $defaultManifest)) {
      throw ('DSH_HOME points at another location without a matching Desktop manifest: ' + $effectiveHome)
    }
    $aHash = (Get-FileHash -LiteralPath $alternateManifest -Algorithm SHA256).Hash
    $bHash = (Get-FileHash -LiteralPath $defaultManifest -Algorithm SHA256).Hash
    if ($aHash -ne $bHash) {
      throw ('DSH_HOME and USERPROFILE desktop manifests differ. Refusing to modify an ambiguous DSH profile: ' + $effectiveHome)
    }
    Info ('Temporary DSH_HOME alias normalization: ' + $effectiveHome + ' -> ' + $defaultHome)
  }
  if (Test-Path -LiteralPath $existingStore -PathType Container) {
    Good ('Existing pnpm virtual store found at: ' + $existingStore)
  } else {
    Info ('Default pnpm virtual store not present: ' + $existingStore)
  }
  return $defaultHome
}
function Find-ExistingVirtualStore([string]$dshHomePath) {
  $desktopProfile = Join-Path $dshHomePath 'profiles\desktop'
  $modulesFile = Join-Path $desktopProfile 'node_modules\.modules.yaml'
  $store = ''
  if (Test-Path -LiteralPath $modulesFile -PathType Leaf) {
    # The DSH pnpm metadata is YAML with JSON-compatible quoted keys.
    # Parse the complete document as JSON first when possible; fall back to
    # ordinary YAML key:value lines, without rewriting anything here.
    $rawMeta = Get-Content -LiteralPath $modulesFile -Raw -Encoding UTF8
    try {
      $objMeta = $rawMeta | ConvertFrom-Json -ErrorAction Stop
      if ($objMeta -and $objMeta.PSObject.Properties['virtualStoreDir']) {
        $store = [string]$objMeta.virtualStoreDir
      }
    } catch { }
    if (-not $store) { foreach ($line in @(Get-Content -LiteralPath $modulesFile -Encoding UTF8)) {
      if ($line -match '^\s*virtualStoreDir:\s*(.*?)\s*$') {
        $store = ([string]$Matches[1]).Trim().Trim([char[]]@([char]34,[char]39)).Replace('/','\')
        break
      }
    } }
  }
  # Some DSH/pnpm installations do not expose virtualStoreDir in .modules.yaml.
  # The currently linked store is still present, and the error message explicitly
  # points to this USERPROFILE path. Reuse it rather than choosing an alias path.
  if (!$store) {
    $candidate = Join-Path $desktopProfile 'node_modules\.pnpm'
    if (Test-Path -LiteralPath $candidate -PathType Container) {
      $store = $candidate
      Info 'pnpm metadata has no virtualStoreDir; reusing the existing .pnpm directory.'
    }
  }
  if (!$store) {
    Info 'No existing virtual store found; leaving pnpm store setting unchanged.'
    return ''
  }
  if (![IO.Path]::IsPathRooted($store)) {
    # pnpm may record the path relative to node_modules.
    $store = Join-Path (Join-Path $desktopProfile 'node_modules') $store
  }
  $store = [IO.Path]::GetFullPath($store)
  if ($store -notmatch '(?i)\\profiles\\desktop\\node_modules\\\.pnpm$') {
    throw ('Unexpected pnpm virtualStoreDir; refusing to redirect: ' + $store)
  }
  if (!(Test-Path -LiteralPath $store -PathType Container)) {
    throw ('Existing pnpm virtual store missing: ' + $store)
  }
  Good ('Using preexisting pnpm virtual store: ' + $store)
  return $store
}
# pnpm 10/11+ may ignore npm_config_virtual_store_dir when invoked by DSH.
# Its supported project-level setting is virtualStoreDir in pnpm-workspace.yaml.
# Use a reversible, narrowly scoped override only during a DSH plugin operation.
# Do NOT delete/reinstall node_modules, move .dsh, or edit .modules.yaml.
function Enter-PnpmWorkspaceOverride([string]$dshHomePath, [string]$existingStore) {
  if (!$existingStore) { return $null }
  $desktopProfile = Join-Path $dshHomePath 'profiles\desktop'
  $workspaceFile = Join-Path $desktopProfile 'pnpm-workspace.yaml'
  $normalizedStore = [IO.Path]::GetFullPath($existingStore)
  if (!(Test-Path -LiteralPath $normalizedStore -PathType Container)) {
    throw ('Cannot verify original pnpm store: ' + $normalizedStore)
  }
  $expectedBase = Join-Path $desktopProfile 'node_modules'
  $relative = $normalizedStore.Substring($expectedBase.Length).TrimStart('\')
  if ($normalizedStore -notmatch '(?i)\\profiles\\desktop\\node_modules\\\.pnpm$' -or $relative -ne '.pnpm') {
    throw ('Refusing virtual store override outside the Desktop node_modules: ' + $normalizedStore)
  }
  # DSH may use a junction/alias C:\dsh\.dsh while dependencies were
  # originally laid out through C:\Users\...\.dsh.  Set the existing path.
  $yamlStore = $normalizedStore.Replace('\','/')
  $lineToAdd = "virtualStoreDir: '" + $yamlStore.Replace("'", "''") + "'"
  $existed = Test-Path -LiteralPath $workspaceFile -PathType Leaf
  $backupBytes = $null
  $unchanged = $false
  if ($existed) {
    $backupBytes = [IO.File]::ReadAllBytes($workspaceFile)
    $raw = [IO.File]::ReadAllText($workspaceFile)
    $m = [regex]::Match($raw, '(?im)^\s*virtualStoreDir\s*:\s*(.*?)\s*$')
    if ($m.Success) {
      $configured = $m.Groups[1].Value.Trim().Trim([char[]]@([char]34,[char]39)).Replace('/','\')
      if ($configured -ieq $normalizedStore) {
        Good 'Existing pnpm-workspace.yaml already selects the original virtual store.'
        $unchanged = $true
      } else {
        throw ('Existing pnpm-workspace.yaml already has a different virtualStoreDir. Will not overwrite it: ' + $configured)
      }
    }
  } else { $raw = '' }
  if (!$unchanged) {
    if ($raw -and !$raw.EndsWith("`n")) { $raw += "`r`n" }
    $raw += '# temporary FishSoul V6.9.19 pnpm compatibility override' + "`r`n" + $lineToAdd + "`r`n"
    [IO.File]::WriteAllText($workspaceFile, $raw, ([System.Text.UTF8Encoding]::new($false)))
    Good ('Temporary pnpm workspace virtualStoreDir: ' + $normalizedStore)
    # Validate whether the C:\dsh\.dsh alias actually observes this file.
    # If it does not, the two profiles are separate; do not silently rewrite
    # either one or risk modifying another DSH installation.
    $aliasProfile = 'C:\dsh\.dsh\profiles\desktop'
    if ((Test-Path -LiteralPath (Join-Path $aliasProfile 'package.json') -PathType Leaf) -and
        $aliasProfile -ine $desktopProfile) {
      $aliasWorkspace = Join-Path $aliasProfile 'pnpm-workspace.yaml'
      if (!(Test-Path -LiteralPath $aliasWorkspace -PathType Leaf) -or
          !([IO.File]::ReadAllText($aliasWorkspace).Contains($lineToAdd))) {
        # Undo the temporary config before refusing.
        if ($existed) { [IO.File]::WriteAllBytes($workspaceFile, [byte[]]$backupBytes) }
        else { Remove-Item -LiteralPath $workspaceFile -Force -ErrorAction SilentlyContinue }
        throw 'C:\dsh\.dsh does not resolve to the same DSH Desktop profile as USERPROFILE. Refusing to change either profile.'
      }
      Good 'DSH_HOME alias sees the same pnpm workspace override.'
    }
  }
  return [pscustomobject]@{
    File=$workspaceFile
    Existed=$existed
    Backup=$backupBytes
    Changed=(!$unchanged)
  }
}
function Exit-PnpmWorkspaceOverride($state) {
  if (!$state -or !$state.Changed) { return }
  try {
    if ($state.Existed) {
      # Restore exact original bytes rather than reconstructing YAML.
      [IO.File]::WriteAllBytes([string]$state.File, [byte[]]$state.Backup)
    } elseif (Test-Path -LiteralPath $state.File -PathType Leaf) {
      # Remove only our own temporary workspace file.
      $text = [IO.File]::ReadAllText([string]$state.File)
      if ($text -match '(?m)^# temporary FishSoul V6\.9\.12 pnpm compatibility override$') {
        Remove-Item -LiteralPath $state.File -Force
      } else {
        Warn 'Temporary workspace file changed unexpectedly; leaving it in place for review.'
        return
      }
    }
    Good 'Original pnpm workspace configuration restored.'
  } catch {
    Warn ('Failed to restore pnpm workspace configuration: ' + $_.Exception.Message)
    throw
  }
}
function Invoke-DSH([string]$cli, [string[]]$arguments) {
  Info ('DSH CLI: ' + $cli)
  Info ('DSH arguments: ' + ($arguments -join ' '))
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $nodeExe = Resolve-Node
  $repairJs = Join-Path $root 'pnpm-store-alias.mjs'
  $repairState = ''
  $captured = @()
  $exitCode = 1
  $previousHome = [Environment]::GetEnvironmentVariable('DSH_HOME','Process')
  try {
    # DSH's inner pnpm may ignore workspace overrides and process-scoped pnpm
    # settings. Reconcile its recorded path only after confirming BOTH aliases
    # resolve to the same physical .pnpm directory. The repair is transactional.
    $repairOutput = @(& $nodeExe $repairJs apply 2>&1 | ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0) {
      throw ('pnpm alias safety check refused: ' + ($repairOutput -join ' | '))
    }
    $repair = ($repairOutput -join "`n") | ConvertFrom-Json
    if ($repair.action -eq 'patched') {
      $repairState = [string]$repair.transaction
      Good ('Backed up and normalized pnpm metadata (transaction: ' + $repairState + ')')
    } elseif ($repair.action -eq 'already-compatible') {
      Good 'pnpm metadata already matches the physical DSH path.'
    } else {
      Good ('pnpm metadata check: ' + $repair.action)
    }
    # Choose the original user spelling for CLI profile reads; realpath
    # normalization may still select C:\dsh\.dsh inside pnpm, which is now
    # reflected in .modules.yaml when both names are physically identical.
    $installHome = Select-InstallDSHHome
    [Environment]::SetEnvironmentVariable('DSH_HOME', $installHome, 'Process')
    Info ('CLI DSH_HOME=' + $installHome)
    $captured = @(& $cli @arguments 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
  } catch {
    $captured += [string]$_.Exception.Message
    $exitCode = 1
  } finally {
    [Environment]::SetEnvironmentVariable('DSH_HOME',$previousHome,'Process')
    if ($repairState) {
      if ($exitCode -eq 0) {
        # Keep pnpm's updated (or unchanged) metadata for subsequent installs.
        try { & $nodeExe $repairJs commit $repairState | Out-Null } catch { Warn ('Could not finalize metadata backup: ' + $_.Exception.Message) }
      } else {
        # Restore only if current file content still equals our patched bytes.
        # If pnpm touched it independently, preserve both versions for review.
        $roll = @(& $nodeExe $repairJs rollback $repairState 2>&1 | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0) { Warn ('Metadata rollback needs review: ' + ($roll -join ' | ')) }
        else { Good 'Original pnpm metadata restored after failed installation.' }
      }
    }
  }
  $safe = @($captured | ForEach-Object {
    $line = [string]$_
    $line -replace '(?i)([?&]token=)[^\s&]+', '$1[REDACTED]' -replace '(?i)(authorization\s*[:=]\s*bearer\s+)[^\s]+', '$1[REDACTED]'
  })
  Add-Content -LiteralPath $installLog -Value ('[' + (Get-Date -Format s) + '] dsh ' + ($arguments -join ' ') + ' (exit ' + $exitCode + ')') -Encoding UTF8
  foreach ($line in $safe) {
    Write-Host $line
    Add-Content -LiteralPath $installLog -Value $line -Encoding UTF8
  }
  if ($exitCode -ne 0) {
    if (($safe -join "`n") -match 'pnpm alias safety check refused') {
      throw ('PNPM_ALIAS_SAFETY_REFUSED: no metadata was modified; see ' + $installLog)
    }
    if (($safe -join "`n") -match 'ERR_PNPM_UNEXPECTED_VIRTUAL_STORE') {
      throw ('PNPM_VIRTUAL_STORE_MISMATCH: install stopped and metadata rollback attempted. See ' + $installLog)
    }
    throw ('DSH plugin command failed, exit=' + $exitCode + '. See ' + $installLog)
  }
}
function Read-Manifest {
  $file = Join-Path $profileDir 'package.json'
  if (!(Test-Path -LiteralPath $file)) { throw 'Desktop DSH profile missing. Start DSH Desktop once to create its profile.' }
  return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Helper-SHA([string]$dir) {
  $parts = foreach ($n in @('package.json','index.js','cordis.patch.yml')) {
    $file = Join-Path $dir $n
    if (!(Test-Path -LiteralPath $file)) { return '' }
    (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  }
  return ($parts -join '-')
}
function Find-InstalledFishVersion {
  $f=Join-Path $profileDir 'node_modules\dsh-fish-soul\package.json'
  try {
    $pkg=Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
    $v=[string]$pkg.version
    if($v -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$'){return $v}
  } catch {}
  return ''
}
function Ensure-Plugins {
  $manifest = Read-Manifest
  $fishPkg = Join-Path $profileDir 'node_modules\dsh-fish-soul\lib\client.js'
  $fishDeclared = $null -ne $manifest.dependencies.PSObject.Properties['dsh-fish-soul']
  $fishBundle = @($manifest.dsh.profile.bundles) -contains 'dsh-fish-soul'
  $fishReady = $fishDeclared -and $fishBundle -and (Test-Path -LiteralPath $fishPkg)
  $installedFishVersion=Find-InstalledFishVersion
  if ($fishReady) {
    Good ('Using existing fish-soul version ' + $installedFishVersion + '; automatic upgrades are disabled.')
  } else {
    Info 'fish-soul is not installed or is incomplete; installing only what is missing.'
  }
  $helperProp = $manifest.dependencies.PSObject.Properties[$helperName]
  $helperDeclared = $null -ne $helperProp
  $helperLinkSpec = if ($helperDeclared) { [string]$helperProp.Value } else { '' }
  $helperModule = Join-Path $profileDir ('node_modules\' + $helperName + '\index.js')
  $helperBundle = @($manifest.dsh.profile.bundles) -contains $helperName
  $helperReady = $helperBundle -and $helperDeclared -and ($helperLinkSpec -match 'DSH-FishSoul-Gateway') -and
    (Test-Path -LiteralPath $helperModule) -and (Helper-SHA $helperSource) -eq (Helper-SHA $helperHome)
  # Keep a working older helper usable without interrupting active DSH tasks.
  # Missing/broken helper links are still repaired into the stable directory.
  if (!$helperReady -and $helperBundle -and $helperDeclared -and (Test-Path -LiteralPath $helperModule)) {
    $freshHandoff = $false
    try {
      $record = Get-Content -LiteralPath $authFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $ageMs = [Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [double]$record.updatedAt)
      $freshHandoff = ($record.schema -eq 1 -and $ageMs -lt 30000 -and $record.url -match '^https?://(localhost|127\.0\.0\.1|\[::1\]):\d+/\?token=')
    } catch {}
    if ($freshHandoff) {
      Good 'Existing legacy token helper is active; preserve it without restarting DSH.'
      $helperReady = $true
    }
  }
  if ($fishReady -and $helperReady) {
    Good 'fish-soul and stable auto-auth helper are already installed. No DSH change.'
    if (!(Desktop-Processes)) {
      $cliForLaunch = $null
      try { $cliForLaunch = Resolve-DSH } catch {}
      $exeForLaunch = Desktop-Executable $cliForLaunch @()
      if (!$exeForLaunch) { throw 'DSH Desktop is not running and its executable was not found for automatic launch.' }
      Info ('Starting DSH Desktop: ' + $exeForLaunch)
      Start-Process -FilePath $exeForLaunch | Out-Null
    }
    return $false
  }
  $running = @(Desktop-Processes)
  $desktopExe = Desktop-Executable '' $running
  $script:desktopExeForRecovery = $desktopExe
  Stop-DesktopGracefully $running
  # Resolve CLI after Desktop closes. Prefer Desktop bundled dsh.cmd over a
  # system npm-installed CLI, which may reject desktop profile modifications.
  $dsh = Resolve-DSH
  New-Item -ItemType Directory -Path $helperHome -Force | Out-Null
  foreach ($name in @('package.json','index.js','cordis.patch.yml')) {
    Copy-Item -LiteralPath (Join-Path $helperSource $name) -Destination (Join-Path $helperHome $name) -Force
  }
  if (!$fishReady) {
    # Installation is allowed only when the plugin is missing/broken.
    # Never reinstall or upgrade a working existing fish-soul plugin.
    $offlineFish = Join-Path (Split-Path -Parent $root) 'dsh-plugin\dsh-fish-soul-0.15.33.tgz'
    if (Test-Path -LiteralPath $offlineFish -PathType Leaf) {
      Info 'Installing bundled fish-soul 0.15.33 tarball (no npm package download needed).'
      Invoke-DSH $dsh @('plugin','--profile','desktop','add',$offlineFish)
    } else {
      Warn 'Offline fish-soul package missing; falling back to existing configured registry.'
      Invoke-DSH $dsh @('plugin','--profile','desktop','add','dsh-fish-soul')
    }
    $afterVersion=Find-InstalledFishVersion
    if (!$afterVersion -or !(Test-Path -LiteralPath $fishPkg)) {
      throw 'fish-soul missing-plugin installation verification failed.'
    }
    Good ('fish-soul installed version: ' + $afterVersion)
  }
  if (!$helperReady) {
    # First attempt a stable local path. If the old link from a moved directory
    # still exists, replace ONLY the token helper, never the fish-soul plugin.
    try { Invoke-DSH $dsh @('plugin','--profile','desktop','add',$helperHome) }
    catch {
      if ($_.Exception.Message -match 'PNPM_VIRTUAL_STORE_MISMATCH|PNPM_ALIAS_SAFETY_REFUSED') { throw }
      Warn ('Initial helper install failed. Repairing stale helper reference. ' + $_.Exception.Message)
      if ($helperDeclared) {
        try { Invoke-DSH $dsh @('plugin','--profile','desktop','remove',$helperName) }
        catch { Warn ('Old helper removal reported a problem: ' + $_.Exception.Message) }
      }
      $fileSpec = 'file:' + ($helperHome -replace '\\','/')
      Invoke-DSH $dsh @('plugin','--profile','desktop','add',$fileSpec)
    }
  }
  $after = Read-Manifest
  if ($null -eq $after.dependencies.PSObject.Properties['dsh-fish-soul'] -or !(Test-Path -LiteralPath $fishPkg)) { throw 'fish-soul install verification failed.' }
  if ($null -eq $after.dependencies.PSObject.Properties[$helperName] -or !(Test-Path -LiteralPath $helperModule)) { throw 'token helper install verification failed.' }
  Good 'DSH plugins installed and verified.'
  if (!$desktopExe) { $desktopExe = Desktop-Executable $dsh @() }
  if (!$desktopExe) { throw 'Plugin installed, but DSH Desktop executable could not be located for restart.' }
  Info ('Starting DSH Desktop: ' + $desktopExe)
  Start-Process -FilePath $desktopExe | Out-Null
  $script:desktopWasStopped = $false
  return $true
}
function Choose-LAN-IP {
  $valid = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
    $_.AddressState -eq 'Preferred' -and (IsPrivate ([string]$_.IPAddress))
  })
  if ($valid.Count -eq 0) { throw 'No preferred private LAN IPv4 address found.' }
  $defaultRoutes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' })
  $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue)
  $ranked = foreach ($address in $valid) {
    $score = 0
    $route = @($defaultRoutes | Where-Object { $_.InterfaceIndex -eq $address.InterfaceIndex } | Sort-Object RouteMetric | Select-Object -First 1)
    if ($route.Count -gt 0) { $score += 100; $score -= [Math]::Min(50,[int]$route[0].RouteMetric) }
    $adapter = @($adapters | Where-Object { $_.ifIndex -eq $address.InterfaceIndex } | Select-Object -First 1)
    if ($adapter.Count -gt 0) {
      if ($adapter[0].Status -eq 'Up') { $score += 20 }
      if ($adapter[0].HardwareInterface) { $score += 8 }
      if (([string]$adapter[0].InterfaceDescription + ' ' + [string]$address.InterfaceAlias) -match 'VPN|TAP|TUN|WireGuard|Tailscale|ZeroTier|Docker|vEthernet|WSL|VirtualBox|Loopback|VMware Virtual Ethernet') { $score -= 80 }
    }
    if ([string]$address.IPAddress -eq $clientIP) { $score -= 10 }
    [pscustomobject]@{ IP=[string]$address.IPAddress; Score=$score; Name=[string]$address.InterfaceAlias }
  }
  $best = $ranked | Sort-Object -Property @{Expression='Score';Descending=$true},@{Expression='IP';Descending=$false} | Select-Object -First 1
  Info ('Selected LAN listening IP: ' + $best.IP + ' [' + $best.Name + ']')
  if ($best.IP -eq $clientIP) { Write-Warning '192.168.2.99 is also this server IP. Remote devices will NOT pass the fixed source-IP allowlist.' }
  return $best.IP
}
# Set the Desktop bundled CLI directory on the Machine PATH exactly once.
# Do not use SETX (may truncate long PATH values). Preserve REG_EXPAND_SZ.
function Cli-MachinePathContains([string]$cliDirectory) {
  $raw = [Environment]::GetEnvironmentVariable('Path','Machine')
  foreach ($part in @([string]$raw -split ';')) {
    $normalized = [Environment]::ExpandEnvironmentVariables($part.Trim().Trim([char]34)).TrimEnd('\')
    if ($normalized -and $normalized.Equals($cliDirectory.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}
function Add-ProcessCliPath([string]$cliDirectory) {
  $found = $false
  foreach ($part in @($env:Path -split ';')) {
    if ($part.Trim().TrimEnd('\').Equals($cliDirectory.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) { $found=$true; break }
  }
  if (!$found) { $env:Path += ';' + $cliDirectory }
}
function Install-SystemCliPath([string]$cli) {
  if (!(Is-Administrator)) { throw 'Installing DSH to the Machine PATH requires administrator permissions.' }
  if (!(Test-Path -LiteralPath $cli -PathType Leaf) -or
      $cli -notlike '*\resources\runtime\cli\bin\dsh.cmd') {
    throw 'Refusing to register a non-bundled DSH command on the Machine PATH.'
  }
  $cliDirectory = Split-Path -Parent $cli
  if (Cli-MachinePathContains $cliDirectory) {
    Good ('System DSH command already registered: ' + $cliDirectory)
    Add-ProcessCliPath $cliDirectory
    return
  }
  $regPath = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
  $reg = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($regPath, $true)
  if (!$reg) { throw 'Cannot open the system Environment registry key for writing.' }
  try {
    $oldValue = [string]$reg.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = $reg.GetValueKind('Path')
    if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and
        $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
      throw 'Unexpected system PATH registry value type. Refusing to overwrite it.'
    }
    $newValue = $oldValue.TrimEnd(';') + ';' + $cliDirectory
    if ($newValue.Length -gt 30000) { throw 'System PATH is too long to update safely.' }
    $reg.SetValue('Path',$newValue,$kind)
  } finally { $reg.Close() }
  if (!(Cli-MachinePathContains $cliDirectory)) { throw 'System PATH update could not be verified.' }
  # Inform Explorer and other applications that environment variables changed.
  try {
    if (!('DSH_PATH_BROADCAST' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DSH_PATH_BROADCAST {
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
}
'@
    }
    $outValue = [IntPtr]::Zero
    [void][DSH_PATH_BROADCAST]::SendMessageTimeout([IntPtr]65535,26,[IntPtr]::Zero,'Environment',2,4000,[ref]$outValue)
  } catch { Warn ('PATH registered, but environment notification was unavailable: ' + $_.Exception.Message) }
  Add-ProcessCliPath $cliDirectory
  Good ('Installed dsh.cmd into SYSTEM PATH: ' + $cliDirectory)
  Info 'New PowerShell/CMD windows can use: dsh --version'
}
function Ensure-SystemDSHCommand([string]$cli) {
  if ($cli -notlike '*\resources\runtime\cli\bin\dsh.cmd') {
    Warn ('DSH is not a Desktop bundled CLI; skipping Machine PATH registration: ' + $cli)
    return
  }
  $cliDirectory = Split-Path -Parent $cli
  if (Cli-MachinePathContains $cliDirectory) {
    Add-ProcessCliPath $cliDirectory
    Good 'System DSH command is already available to new terminals.'
    return
  }
  if (Is-Administrator) { Install-SystemCliPath $cli; return }
  Info 'Registering DSH Desktop CLI on the system PATH (Windows UAC may appear once).'
  $argLine = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root 'deploy.ps1') + '" -InstallCliPathOnly -CliPath "' + $cli + '"'
  try {
    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -Verb RunAs -Wait -PassThru -ErrorAction Stop
    if ($proc.ExitCode -ne 0 -or !(Cli-MachinePathContains $cliDirectory)) {
      Warn 'System PATH registration was not completed. The gateway can still use the full bundled CLI path.'
      return
    }
    Add-ProcessCliPath $cliDirectory
    Good 'System PATH now includes the DSH Desktop CLI.'
  } catch {
    Warn ('System PATH registration was declined or failed: ' + $_.Exception.Message)
    Warn 'The application can still start using the full Desktop CLI path.'
  }
}
function Is-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Rule-Matches([string]$ip) {
  $r = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($r.Count -ne 1) { return $false }
  $rule = $r[0]
  $ports = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue)
  $addresses = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue)
  if ($ports.Count -ne 1 -or $addresses.Count -ne 1) { return $false }
  $p = $ports[0]; $a = $addresses[0]
  return $rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and
    $rule.Action -eq 'Allow' -and [string]$rule.Profile -eq 'Any' -and $p.Protocol -eq 'TCP' -and
    [string]$p.LocalPort -eq [string]$port -and
    [string]$a.LocalAddress -eq $ip -and
    ([string]$a.RemoteAddress -eq $clientIP -or [string]$a.RemoteAddress -eq ($clientIP + '/32'))
}
function Install-Firewall([string]$ip) {
  if (!(IsPrivate $ip) -or $ip -eq '0.0.0.0') { throw 'Firewall bind IP is not a private IPv4 address.' }
  $existing = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) { $existing | Remove-NetFirewallRule -ErrorAction Stop }
  New-NetFirewallRule -DisplayName $ruleName -Description ('FishSoul LAN: allow only source ' + $clientIP) `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -LocalAddress $ip `
    -RemoteAddress $clientIP -Profile Any -EdgeTraversalPolicy Block | Out-Null
  if (!(Rule-Matches $ip)) { throw 'Firewall rule verification failed after creation.' }
  Good ('Firewall: ' + $clientIP + ' -> ' + $ip + ':' + $port + ' only')
}
function Ensure-Firewall([string]$ip) {
  if (Rule-Matches $ip) { Good 'Scoped Windows Firewall rule already valid.'; return }
  if (Is-Administrator) { Install-Firewall $ip; return }
  Info 'Windows firewall needs elevated access. Windows may show one UAC consent.'
  $argLine = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root 'deploy.ps1') + '" -FirewallOnly -BindIP ' + $ip
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -Verb RunAs -Wait -PassThru
  if ($proc.ExitCode -ne 0 -or !(Rule-Matches $ip)) { throw 'Firewall configuration failed or elevation was declined.' }
}
# SnowLuma binds 0.0.0.0 ONLY after two verified Windows Defender Firewall
# rules are installed: an Allow for VMO 192.168.2.99, and a higher-priority
# Block for every other non-loopback IPv4 address. If verification fails,
# the supervisor is instructed to bind 127.0.0.1 only.
function Snow-Firewall-Name([int]$snowPort){ return ('DSH SnowLuma WebUI VMO ' + $snowPort + ' (scoped)') }
function Snow-Deny-Name([int]$snowPort){ return ('DSH SnowLuma WebUI other IPv4 ' + $snowPort + ' (deny)') }
function Snow-Blocked-Addresses {
  # Exclude 127.0.0.0/8 (Guest Agent localhost) and 192.168.2.99 only.
  return @('0.0.0.0-126.255.255.255','128.0.0.0-192.168.2.98','192.168.2.100-255.255.255.255')
}
function Snow-Firewall-RuleValid([string]$name,[string]$action,[int]$snowPort,[string[]]$remote) {
  $rules = @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)
  if ($rules.Count -ne 1) { return $false }
  $r = $rules[0]
  $pf = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue)
  $af = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue)
  if ($pf.Count -ne 1 -or $af.Count -ne 1 -or $r.Enabled -ne 'True' -or
      $r.Direction -ne 'Inbound' -or $r.Action -ne $action -or
      [string]$pf[0].Protocol -ne 'TCP' -or [string]$pf[0].LocalPort -ne [string]$snowPort) { return $false }
  $actual = @($af[0].RemoteAddress | ForEach-Object { [string]$_ } | Sort-Object)
  $expected = @($remote | ForEach-Object { [string]$_ } | Sort-Object)
  if ($actual.Count -ne $expected.Count) { return $false }
  for ($i=0; $i -lt $expected.Count; $i++) { if ($actual[$i] -ne $expected[$i]) { return $false } }
  return $true
}
function Snow-Rule-Matches([string]$ip,[int]$snowPort) {
  $allow = Snow-Firewall-RuleValid (Snow-Firewall-Name $snowPort) 'Allow' $snowPort @($clientIP,($clientIP + '/32'))
  # Windows normalizes /32 to IP on some versions. Check either spelling.
  if (-not $allow) { $allow = Snow-Firewall-RuleValid (Snow-Firewall-Name $snowPort) 'Allow' $snowPort @($clientIP) }
  $deny = Snow-Firewall-RuleValid (Snow-Deny-Name $snowPort) 'Block' $snowPort @(Snow-Blocked-Addresses)
  return $allow -and $deny
}
function Install-Snow-Firewall([string]$ip,[int]$snowPort) {
  if (!(Is-Administrator)) { throw 'SnowLuma firewall setup requires administrator privileges.' }
  if (!(IsPrivate $ip) -or $ip -eq $clientIP -or $snowPort -lt 1024 -or $snowPort -gt 65535) { throw 'Invalid SnowLuma firewall configuration.' }
  $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
  if (@($profiles | Where-Object { $_.Enabled -ne $true -or $_.DefaultInboundAction -eq 'Allow' }).Count -gt 0) {
    throw 'Windows Defender Firewall disabled or permits all inbound connections; cannot enable 0.0.0.0.'
  }
  $allowName = Snow-Firewall-Name $snowPort
  $denyName = Snow-Deny-Name $snowPort
  # Install the deny rule first to avoid a temporarily exposed listener.
  foreach ($name in @($denyName,$allowName)) {
    $existing = @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) { $existing | Remove-NetFirewallRule -ErrorAction Stop }
  }
  New-NetFirewallRule -DisplayName $denyName -Description 'Block all other non-loopback IPv4 clients for SnowLuma' `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort $snowPort `
    -RemoteAddress (Snow-Blocked-Addresses) -Profile Any -EdgeTraversalPolicy Block | Out-Null
  New-NetFirewallRule -DisplayName $allowName -Description ('SnowLuma only VMO management host ' + $clientIP) `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $snowPort `
    -RemoteAddress $clientIP -Profile Any -EdgeTraversalPolicy Block | Out-Null
  if (!(Snow-Rule-Matches $ip $snowPort)) { throw 'SnowLuma allow/deny firewall verification failed.' }
  Good ('SnowLuma: listening 0.0.0.0 with Windows Firewall allow ' + $clientIP + ', block other non-loopback IPv4 on port ' + $snowPort)
}
function Ensure-Snow-Firewall([string]$ip,[int]$snowPort) {
  if (Snow-Rule-Matches $ip $snowPort) { Good 'SnowLuma scoped allow/deny rules already valid.'; return }
  if (Is-Administrator) { Install-Snow-Firewall $ip $snowPort; return }
  Info 'Installing SnowLuma two-rule firewall; Windows UAC consent required.'
  $argLine = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root 'deploy.ps1') + '" -SnowFirewallOnly -BindIP ' + $ip + ' -SnowPort ' + $snowPort
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -Verb RunAs -Wait -PassThru
  if ($proc.ExitCode -ne 0 -or !(Snow-Rule-Matches $ip $snowPort)) { throw 'SnowLuma firewall verification failed or UAC was declined.' }
}
function Stop-Prior-Gateway {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($pidToCheck in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$pidToCheck) -ErrorAction SilentlyContinue
    $cmdLine = [string]$proc.CommandLine
    if ($proc -and $proc.Name -match '^node\.exe$' -and $cmdLine -match 'server\.mjs' -and $cmdLine -match 'DSH_fish_soul|DSH-FishSoul|dsh-fish-soul-bridage') {
      Info ('Stopping previous FishSoul gateway process: ' + $pidToCheck)
      Stop-Process -Id $pidToCheck -Force -ErrorAction Stop
    } elseif ($proc) { throw ('Port 56781 is in use by PID ' + $pidToCheck + ' (' + $proc.Name + '). Not stopping an unrelated process.') }
  }
}
try {
  if ($FirewallOnly) {
    Install-Firewall $BindIP
    exit 0
  }
  if ($SnowFirewallOnly) {
    Install-Snow-Firewall $BindIP $SnowPort
    exit 0
  }
  if ($InstallCliPathOnly) {
    Install-SystemCliPath $CliPath
    exit 0
  }
  Info 'DSH FishSoul V1.0.0 - business operations enabled; protected SnowLuma 0.0.0.0 / start'
  Info 'Fixed LAN SOURCE allowlist: 192.168.2.99/32; localhost still available.'
  $node = Resolve-Node
  $rawVersion = (& $node --version).Trim()
  $nodeParts = [version]($rawVersion.TrimStart('v').Split('-')[0])
  if ($nodeParts -lt [version]'22.5.0') { throw ('Node.js 22.5+ required, found ' + $rawVersion) }
  Good ('Node: ' + $rawVersion)
  # No DSH Desktop or fish-soul auto-update checks or installs on startup.
  # Only ensure bundled CLI is on PATH; retain existing installed versions.
  $dshCliForPath = Resolve-DSH
  Ensure-SystemDSHCommand $dshCliForPath
  try { [void](Ensure-Plugins) } catch { Warn ('DSH plugin installation verification failed; starting local login gateway in degraded mode. Error type=' + $_.Exception.GetType().Name) }
  if ($InstallOnly) { Good 'Plugin installation complete. No menu or confirmation was required.'; exit 0 }
  # Never block the local 56781 login page when a VM has no eligible LAN NIC
  # or UAC firewall setup fails. LAN access stays OFF in that case.
  $lanIP = ''
  try {
    $candidateIP = Choose-LAN-IP
    Ensure-Firewall $candidateIP
    $lanIP = $candidateIP
  } catch {
    Warn ('Optional LAN binding skipped; localhost still works. Category=' + $_.Exception.GetType().Name)
  }
  $react = Join-Path $root 'vendor\react.js'
  $reactDom = Join-Path $root 'vendor\react-dom.js'
  if (!(Test-Path -LiteralPath $react) -or !(Test-Path -LiteralPath $reactDom)) {
    Info 'Preparing pinned React runtime automatically.'
    & $node (Join-Path $root 'setup-runtime.mjs')
    if ($LASTEXITCODE -ne 0) { Warn 'React runtime preparation failed. 56781 login will remain available, native UI will require runtime repair.' }
  }
  # Do not trust a recently-written handoff file as proof of a usable
  # session. The Node gateway retries the REAL cookie exchange across Host
  # startup/token rotation, with no manual input or token disclosure.
  # Optional SnowLuma supervisor: captures this boot's random password in
  # memory and sends it to VMO only after the WebUI HTTP listener is healthy.
  # Never start a second SnowLuma if an unmanaged index.mjs process exists.
  # Real installations may use C:\dsh\SnowLuma-v2.4.0-win-x64 rather than
  # C:\dsh\SnowLuma. Find the existing executable before starting it.
  $snowCandidates = @()
  if ($env:SNOWLUMA_DIR) { $snowCandidates += $env:SNOWLUMA_DIR }
  $snowCandidates += @('C:\dsh\SnowLuma')
  if (Test-Path -LiteralPath 'C:\dsh') {
    $snowCandidates += @(Get-ChildItem -LiteralPath 'C:\dsh' -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^SnowLuma(?:[-_].*)?$' } |
      Sort-Object -Property LastWriteTime -Descending |
      ForEach-Object { $_.FullName })
  }
  # Check the full WebUI asset set: supplied overlays can contain index.mjs but no CSS.
  # Do not launch a partial overlay as if it were a complete SnowLuma installation.
  $snowRoot = $snowCandidates | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_ 'index.mjs') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_ 'client\index.html') -PathType Leaf) -and
    (@(Get-ChildItem -LiteralPath (Join-Path $_ 'client\assets') -Filter '*.css' -ErrorAction SilentlyContinue).Count -gt 0)
  } | Select-Object -First 1
  $snowEntry = if ($snowRoot) { Join-Path $snowRoot 'index.mjs' } else { $null }
  if ($snowRoot) { $env:SNOWLUMA_DIR = $snowRoot }
  if ($snowEntry -and (Test-Path -LiteralPath $snowEntry -PathType Leaf)) {
    $existingMonitor = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and $_.CommandLine.Contains('snowluma-supervisor.mjs')
    })
    if ($existingMonitor.Count -gt 0) {
      Info 'SnowLuma reporting supervisor is already active; no duplicate launched.'
    } else {
      $allWindowsProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
      # The stock launcher.bat commonly runs `node .\index.mjs`, in which
      # case the absolute SnowLuma directory is only in the parent cmd.exe.
      $launchers = @($allWindowsProcesses | Where-Object {
        $_.Name -match '^cmd\.exe$' -and $_.CommandLine -and
        $_.CommandLine.Contains($snowRoot) -and $_.CommandLine -match 'launcher\.bat'
      })
      $launcherPids = @($launchers | ForEach-Object { [int]$_.ProcessId })
      $snowWatch = @($allWindowsProcesses | Where-Object {
        $_.Name -match '^(node|node64)\.exe$' -and
        (($_.CommandLine -and $_.CommandLine.Contains($snowEntry)) -or
         (($_.CommandLine -match '(?i)(?:^|[\\/\s])index\.mjs(?:[\s\"]|$)') -and
          ($launcherPids -contains [int]$_.ParentProcessId -or
           ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($snowRoot,[System.StringComparison]::OrdinalIgnoreCase)))))
      })
      # Independently recognize an already running WebUI so a manually
      # launched SnowLuma is not duplicated when its PID path is relative.
      $snowWebSeen = $false
      $snowObservedPort = $null
      foreach ($probePort in @(5099,15099,15100,15101,15102,15103)) {
        try {
          $response = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $probePort + '/') -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
          if ([string]$response.Content -match '(?i)snowluma') { $snowWebSeen = $true; $snowObservedPort = $probePort; break }
        } catch { }
      }
      # If a SnowLuma process is present but has NO LISTENING TCP socket,
      # it may be the failed WebUI shown in the user's log. Restart only
      # these precisely identified SnowLuma Node PIDs, never other Node apps.
      if ($snowWatch.Count -gt 0) {
        $ids = @($snowWatch | ForEach-Object { [int]$_.ProcessId })
        $activeListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
          $ids -contains [int]$_.OwningProcess -and $_.LocalPort -ge 1024
        })
        if ($activeListeners.Count -eq 0) {
          Warn 'Existing SnowLuma process has no TCP WebUI listener; restarting that specific process for port recovery.'
          foreach ($proc in $snowWatch) { try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
          Start-Sleep -Seconds 2
          $snowWatch = @()
        }
      }
      # WEBUI_HOST is a single socket binding, not an HTTP host allowlist.
      # User-requested 0.0.0.0 is ONLY enabled after Windows Firewall is
      # configured to block non-management inbound clients. Public host.tmd.pet
      # continues to use VMO WSS; it is NOT a permitted raw LAN peer.
      Remove-Item Env:SNOWLUMA_LAN_BIND_IP -ErrorAction SilentlyContinue
      $env:SNOWLUMA_LAN_RELAY = '0'
      $env:SNOWLUMA_WEBUI_HOST = '127.0.0.1'
      if ($lanIP) {
        $requestedPort = 5099
        if ($env:SNOWLUMA_WEBUI_PORT -match '^\d+$') { $requestedPort = [int]$env:SNOWLUMA_WEBUI_PORT }
        else {
          try {
            $j = Get-Content (Join-Path $snowRoot 'config\runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.webuiPort -ge 1024 -and $j.webuiPort -le 65535) { $requestedPort = [int]$j.webuiPort }
          } catch {}
        }
        try {
          Ensure-Snow-Firewall $lanIP $requestedPort
          $env:SNOWLUMA_WEBUI_HOST = '0.0.0.0'
          Info ('SnowLuma 0.0.0.0:' + $requestedPort + ' protected by firewall. Allowed source: ' + $clientIP + '. VMO domain via WSS only.')
        } catch {
          Warn ('SnowLuma will stay at 127.0.0.1; 0.0.0.0 firewall setup failed: ' + $_.Exception.GetType().Name)
        }
      } else {
        Warn 'No verified LAN interface; SnowLuma binding remains localhost-only.'
      }
      # Quote a possible space-containing directory without using shell interpolation.
      $snowArgs = @('"' + (Join-Path $root 'snowluma-supervisor.mjs') + '"')
      if ($snowWatch.Count -gt 0 -or $snowWebSeen) {
        $snowArgs += '--observe'
        if ($snowObservedPort) { $env:SNOWLUMA_WEBUI_PORT = [string]$snowObservedPort }
        Info 'SnowLuma already running: observer cannot change SNOWLUMA_WEBUI_HOST. Stop the original SnowLuma before relaunch to switch to 0.0.0.0; previous password cannot be recovered.'
      } else {
        Info 'Starting SnowLuma with secure, in-memory bootstrap-password capture and port preflight.'
      }
      # The supervisor filters secrets from output; persist only its safe
      # status/diagnostic lines, not SnowLuma raw stdout/stderr.
      $snowProc = Start-Process -FilePath $node -ArgumentList $snowArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'snowluma-supervisor.stdout.log') `
        -RedirectStandardError (Join-Path $logDir 'snowluma-supervisor.stderr.log')
      Good ('SnowLuma reporting supervisor started, PID=' + $snowProc.Id)
    }
  } else {
    Warn 'No COMPLETE SnowLuma WebUI installation found (overlay lacks CSS assets). Skipping SnowLuma to avoid broken client UI. Supply full SnowLuma via SNOWLUMA_DIR.'
  }
  Info 'Gateway will verify the current Host session and retry after DSH restarts.'
  Stop-Prior-Gateway
  $env:FS_LAN_BIND_IP = $lanIP
  $env:FS_LAN_ALLOWED_CIDRS = $clientIP + '/32'
  $env:FS_GATEWAY_PORT = [string]$port
  $env:FS_AUTO_AUTH_ONLY = '1'
  if (-not $env:FS_VMO_PROXY_ORIGINS) { $env:FS_VMO_PROXY_ORIGINS = 'http://192.168.2.99:8766,https://192.168.2.99:8766,https://host.tmd.pet' }
  Info 'VMO console Origin compatibility enabled for 192.168.2.99:8766 only; unrelated origins remain blocked.'
  Good ('Local URL: http://127.0.0.1:' + $port + '/')
  if ($lanIP) { Good ('LAN URL: http://' + $lanIP + ':' + $port + '/ (source ' + $clientIP + ' only)') }
  else { Warn 'LAN access disabled; local gateway will still start.' }
  Info 'Application reports: 127.0.0.1:18767 with local trusted Python reporter fallback (HTTP 404). No credentials in logs. DSH admin routes blocked.'
  if (!(Is-Administrator)) { Warn 'If the VMO HTTP route is 404, Report-App-JSON.py fallback may require running Start.cmd as Administrator.' }
  & $node (Join-Path $root 'server.mjs')
  if ($LASTEXITCODE -ne 0) { throw ('Gateway exited with code ' + $LASTEXITCODE) }
  exit 0
} catch {
  Write-Host ('[FAIL] ' + $_.Exception.Message) -ForegroundColor Red
  if ($script:desktopWasStopped -and $script:desktopExeForRecovery -and (Test-Path -LiteralPath $script:desktopExeForRecovery)) {
    if ((@(Desktop-Processes)).Count -eq 0) {
      Warn 'Installation did not finish. Restarting DSH Desktop to restore the original working environment.'
      try {
        Start-Process -FilePath $script:desktopExeForRecovery | Out-Null
        Good 'DSH Desktop restart requested.'
      } catch { Warn ('Desktop recovery failed: ' + $_.Exception.Message) }
    }
  }
  Write-Host ('[INFO] Installer log (if the CLI was reached): ' + $installLog) -ForegroundColor Cyan
  exit 1
}

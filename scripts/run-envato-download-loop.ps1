$ErrorActionPreference = "Stop"

$Workspace = "D:\code\copy-website"
$SkipIds = "6AH5AZT"
$LogPath = Join-Path $Workspace "data\download-loop.log"
$StatePath = Join-Path $Workspace "data\download-loop-state.json"
$RunPath = Join-Path $Workspace "data\download-run-latest.json"
$FailedPath = Join-Path $Workspace "data\download-failed-queue.json"
$BatchSize = 3
$WaitSeconds = 60

Set-Location $Workspace

function Write-LoopLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $LogPath -Value "[$timestamp] $Message" -Encoding UTF8
}

function Get-DownloadedCount {
  $json = Get-Content -Path "data\templates.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  return @($json.templates | Where-Object { $_.downloaded -eq $true }).Count
}

$round = 0
Write-LoopLog "Loop started. limit=$BatchSize wait_seconds=$WaitSeconds skip=$SkipIds"

while ($true) {
  $round += 1
  $before = Get-DownloadedCount
  $failedIds = @()
  if (Test-Path $FailedPath) {
    $failedIds = @((Get-Content -Path $FailedPath -Raw -Encoding UTF8 | ConvertFrom-Json).failedIds)
  }
  $effectiveSkip = @($SkipIds.Split(",") + $failedIds | Where-Object { $_ } | Select-Object -Unique) -join ","
  Write-LoopLog "Round $round started. downloaded_before=$before skip=$effectiveSkip"

  $output = & node .\scripts\auto-download-envato-chrome.mjs --limit $BatchSize --skip $effectiveSkip 2>&1
  $exitCode = $LASTEXITCODE
  $output | ForEach-Object { Write-LoopLog $_ }

  $after = Get-DownloadedCount
  $status = "ok"
  $reason = ""
  $results = @()

  if (Test-Path $RunPath) {
    $run = Get-Content -Path $RunPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $results = @($run.results)
    $bad = @($results | Where-Object { $_.status -ne "downloaded" })
    if ($bad.Count -gt 0) {
      $newFailedIds = @($bad | ForEach-Object { $_.itemId } | Where-Object { $_ })
      $allFailedIds = @($failedIds + $newFailedIds | Select-Object -Unique)
      [pscustomobject]@{
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        failedIds = $allFailedIds
        lastFailed = $bad
      } | ConvertTo-Json -Depth 8 | Set-Content -Path $FailedPath -Encoding UTF8
      $reason = "skipped-failed-items"
    }
  }

  if ($exitCode -ne 0) {
    $status = "stopped"
    $reason = "node-exit-$exitCode"
  }

  if (($after - $before) -lt 1) {
    $status = "stopped"
    if (-not $reason) { $reason = "download-count-did-not-increase" }
  }

  $state = [pscustomobject]@{
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    round = $round
    status = $status
    reason = $reason
    downloadedBefore = $before
    downloadedAfter = $after
    lastResults = $results
  }
  $state | ConvertTo-Json -Depth 8 | Set-Content -Path $StatePath -Encoding UTF8

  Write-LoopLog "Round $round finished. downloaded_after=$after status=$status reason=$reason"

  if ($status -ne "ok") {
    Write-LoopLog "Loop stopped."
    break
  }

  Write-LoopLog "Waiting $WaitSeconds seconds."
  Start-Sleep -Seconds $WaitSeconds
}

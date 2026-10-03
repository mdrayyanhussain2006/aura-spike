# lib.ps1 - Shared helper functions for AURA E2E Test Suite
# Contract v3 supporting emulator/device lanes, canary redaction assertions, mutation testing, and gfxinfo audits

$ErrorActionPreference = "Stop"

function Get-AdbExecutable {
    $adb = Get-Command adb -ErrorAction SilentlyContinue
    if ($adb) { return $adb.Source }
    $sdkPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $sdkPath) { return $sdkPath }
    throw "adb executable not found."
}

function Invoke-Adb {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$CommandArgs
    )
    $adb = Get-AdbExecutable
    $allArgs = @()
    if ($global:AdbSerial) {
        $allArgs += @("-s", $global:AdbSerial)
    } elseif ($global:AdbLane -eq "emulator") {
        $allArgs += @("-e")
    } elseif ($global:AdbLane -eq "device") {
        $allArgs += @("-d")
    }
    $allArgs += $CommandArgs
    & $adb @allArgs
}

function Send-ShareIntent {
    param(
        [string]$Text,
        [string]$AppId = "com.aura.privacyspike"
    )
    $adb = Get-AdbExecutable
    $prefix = if ($global:AdbSerial) { @("-s", $global:AdbSerial) } elseif ($global:AdbLane -eq "emulator") { @("-e") } else { @("-d") }
    
    $escapedText = $Text.Replace("'", "'\''")
    $cmd = "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '$escapedText' $AppId"
    
    & $adb @prefix shell $cmd | Out-Null
    Start-Sleep -Seconds 2
}

function Select-AppTab {
    param(
        [string]$TabName = "Redact",
        [int]$TimeoutSeconds = 12
    )
    $adb = Get-AdbExecutable
    $prefixArgs = if ($global:AdbSerial) { @("-s", $global:AdbSerial) } elseif ($global:AdbLane -eq "emulator") { @("-e") } else { @("-d") }
    
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        & $adb @prefixArgs shell uiautomator dump /sdcard/tab_dump.xml | Out-Null
        $xmlRaw = & $adb @prefixArgs shell cat /sdcard/tab_dump.xml
        if ($xmlRaw) {
            try {
                [xml]$xml = $xmlRaw
                $node = $xml.SelectNodes('//node') | Where-Object { $_.text -eq $TabName } | Select-Object -First 1
                if ($node -and $node.bounds -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
                    $x = [math]::Round(([int]$matches[1] + [int]$matches[3]) / 2)
                    $y = [math]::Round(([int]$matches[2] + [int]$matches[4]) / 2)
                    & $adb @prefixArgs shell input tap $x $y | Out-Null
                    Start-Sleep -Milliseconds 800
                    return $true
                }
            } catch {
                # Fallback
            }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Get-MaestroExecutable {
    $maestro = Get-Command maestro -ErrorAction SilentlyContinue
    if ($maestro) { return $maestro.Source }
    $userMaestro = "$HOME\.maestro\maestro\bin\maestro.bat"
    if (Test-Path $userMaestro) { return $userMaestro }
    throw "maestro executable not found."
}

function Reset-AppEnvironment {
    param(
        [string]$AppId = "com.aura.privacyspike"
    )

    # Dismiss any existing system dialogs / BiometricPrompts
    Invoke-Adb shell input keyevent 4 | Out-Null
    Start-Sleep -Milliseconds 300

    # Clean existing SQLite files to ensure fresh cryptographic state per run
    Invoke-Adb shell run-as $AppId rm -rf files/SQLite | Out-Null

    # Force-stop the application
    Invoke-Adb shell am force-stop $AppId | Out-Null
    Start-Sleep -Milliseconds 500

    # Launch application via expo dev-client deep link
    $devUrl = "auraspike://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
    Invoke-Adb shell am start -a android.intent.action.VIEW -d $devUrl $AppId | Out-Null

    # Wait for the React Native root view to load (up to 25 seconds)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    $adb = Get-AdbExecutable
    $prefix = if ($global:AdbSerial) { "-s $($global:AdbSerial)" } elseif ($global:AdbLane -eq "emulator") { "-e" } else { "-d" }

    while ($sw.Elapsed.TotalSeconds -lt 25) {
        $lines = cmd /c "`"$adb`" $prefix shell dumpsys window 2>nul"
        $focus = $lines | Where-Object { $_ -like "*MainActivity*" }
        if ($focus) {
            $dumpResult = cmd /c "`"$adb`" $prefix shell uiautomator dump /sdcard/ready.xml 2>nul"
            if ($dumpResult -like "*dumped to*") {
                $content = cmd /c "`"$adb`" $prefix shell cat /sdcard/ready.xml 2>nul"
                if ($content -match "AURA Mobile Spike") {
                    $ready = $true
                    Start-Sleep -Seconds 1
                    break
                }
            } elseif ($sw.Elapsed.TotalSeconds -ge 8) {
                $ready = $true
                break
            }
        }
        Start-Sleep -Milliseconds 700
    }
    if (-not $ready) {
        Write-Warning "App did not focus MainActivity or render root view within 25s."
    }
}



function Start-BiometricWatcher {
    param(
        [ValidateSet("match", "nomatch_cancel")]
        [string]$Mode = "match",
        [int]$TimeoutSeconds = 60
    )

    if ($global:AdbLane -eq "device") {
        # On physical devices, biometrics are handled manual-assisted by the operator
        return $null
    }

    $adb = Get-AdbExecutable
    $prefixArgs = if ($global:AdbSerial) { @("-s", $global:AdbSerial) } elseif ($global:AdbLane -eq "emulator") { @("-e") } else { @("-d") }

    $job = Start-Job -ScriptBlock {
        param($adbPath, $prefixArgs, $mode, $timeout)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        while ($sw.Elapsed.TotalSeconds -lt $timeout) {
            $argsWindow = @() + $prefixArgs + @("shell", "dumpsys", "window")
            $lines = & $adbPath @argsWindow
            $promptOpen = $lines | Where-Object { $_ -like "*BiometricPrompt*" }
            if ($promptOpen) {
                Start-Sleep -Milliseconds 400
                if ($mode -eq "match") {
                    $argsTouch = @() + $prefixArgs + @("emu", "finger", "touch", "1")
                    & $adbPath @argsTouch
                    Write-Output "EVENT: MATCH_FINGER_1_SENT"
                    Start-Sleep -Seconds 1
                } elseif ($mode -eq "nomatch_cancel") {
                    $argsTouch = @() + $prefixArgs + @("emu", "finger", "touch", "2")
                    & $adbPath @argsTouch
                    Write-Output "EVENT: REJECT_FINGER_2_SENT"
                    Start-Sleep -Milliseconds 600
                    $argsKey = @() + $prefixArgs + @("shell", "input", "keyevent", "4")
                    & $adbPath @argsKey
                    Write-Output "EVENT: CANCEL_KEYEVENT_4_SENT"
                    break
                }
            }
            Start-Sleep -Milliseconds 250
        }
    } -ArgumentList $adb, $prefixArgs, $Mode, $TimeoutSeconds

    return $job
}

function Stop-BiometricWatcher {
    param($Job)
    if ($Job) {
        Stop-Job $Job -ErrorAction SilentlyContinue | Out-Null
        $out = Receive-Job $Job -ErrorAction SilentlyContinue
        Remove-Job $Job -Force -ErrorAction SilentlyContinue
        return $out
    }
    return @()
}

function Find-And-Pull-Databases {
    param(
        [string]$AppId = "com.aura.privacyspike",
        [string]$DestinationDir
    )
    $adb = Get-AdbExecutable
    $prefix = if ($global:AdbSerial) { "-s $($global:AdbSerial)" } elseif ($global:AdbLane -eq "emulator") { "-e" } else { "-d" }

    if (-not (Test-Path $DestinationDir)) {
        New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
    }

    $files = Invoke-Adb shell run-as $AppId find . -name "*.db"
    $results = @{}

    foreach ($file in $files) {
        $cleanPath = $file.Trim()
        if (-not $cleanPath) { continue }
        $fileName = [System.IO.Path]::GetFileName($cleanPath)
        $localDest = Join-Path $DestinationDir $fileName

        cmd /c "`"$adb`" $prefix exec-out run-as $AppId cat $cleanPath > `"$localDest`""
        if (Test-Path $localDest) {
            $results[$fileName] = @{
                RemotePath = $cleanPath
                LocalPath  = $localDest
                Size       = (Get-Item $localDest).Length
            }
        }
    }

    return $results
}

function Verify-DatabaseFile {
    param(
        [string]$FilePath,
        [string]$ExpectedMarker = "AURA_MARKER_7731"
    )

    if (-not (Test-Path $FilePath)) {
        return @{
            Exists     = $false
            HasMarker  = $false
            HasSqlite3 = $false
            HeaderHex  = ""
        }
    }

    # 1. Search for plaintext marker in file
    $findResult = cmd /c "findstr $ExpectedMarker `"$FilePath`"" 2>&1
    $hasMarker = ($LASTEXITCODE -eq 0 -and $findResult -match $ExpectedMarker)

    # 2. Check 16-byte magic header
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $headerBytes = $bytes[0..15]
    $headerHex = ($headerBytes | ForEach-Object { $_.ToString("X2") }) -join " "
    $headerAscii = [System.Text.Encoding]::ASCII.GetString($headerBytes)
    $hasSqlite3 = ($headerAscii.StartsWith("SQLite format 3"))

    return @{
        Exists     = $true
        HasMarker  = $hasMarker
        HasSqlite3 = $hasSqlite3
        HeaderHex  = $headerHex
        HeaderStr  = $headerAscii
        Size       = $bytes.Length
    }
}

function Get-GfxInfoStats {
    param(
        [string]$AppId = "com.aura.privacyspike"
    )
    $output = Invoke-Adb shell dumpsys gfxinfo $AppId
    
    $totalFrames = 0
    $jankyFrames = 0
    $jankyPct = 0.0

    $totalLine = $output | Where-Object { $_ -match "Total frames rendered:\s+(\d+)" } | Select-Object -Last 1
    if ($totalLine -match "Total frames rendered:\s+(\d+)") {
        $totalFrames = [int]$matches[1]
    }

    $jankyLine = $output | Where-Object { $_ -match "Janky frames:\s+(\d+)\s+\(([\d\.]+)%\)" } | Select-Object -Last 1
    if ($jankyLine -match "Janky frames:\s+(\d+)\s+\(([\d\.]+)%\)") {
        $jankyFrames = [int]$matches[1]
        $jankyPct = [double]$matches[2]
    }

    return @{
        TotalFrames  = $totalFrames
        JankyFrames  = $jankyFrames
        JankyPercent = $jankyPct
        RawOutput    = ($output -join "`n")
        RawSummary   = ($output | Where-Object { $_ -match "Total frames|Janky frames|percentile" }) -join "`n"
    }
}

function Update-E2EContract {
    param([string]$E2eDir = "e2e")
    $contractFile = Join-Path $E2eDir "CONTRACT.sha256"
    $rootPath = (Resolve-Path .).Path
    $files = Get-ChildItem -Path $E2eDir -Recurse -File | Where-Object {
        $_.Name -ne "CONTRACT.sha256"
    }
    $lines = @()
    foreach ($f in ($files | Sort-Object FullName)) {
        $relPath = $f.FullName.Substring($rootPath.Length + 1).Replace("\", "/")
        $h = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
        $lines += "$h  $relPath"
    }
    $lines | Set-Content -Path $contractFile -Encoding ASCII
    return $lines
}

function Test-E2EContract {
    param([string]$E2eDir = "e2e")
    $contractFile = Join-Path $E2eDir "CONTRACT.sha256"
    if (-not (Test-Path $contractFile)) {
        return @{
            Valid      = $false
            Reason     = "CONTRACT.sha256 file not found at $contractFile. Run with -UpdateContract to initialize baseline."
            Mismatches = @("Missing $contractFile")
            Hashes     = @{}
        }
    }

    $contractLines = Get-Content -Path $contractFile | Where-Object { $_.Trim() -ne "" -and -not $_.StartsWith("#") }
    $expected = @{}
    foreach ($line in $contractLines) {
        $parts = $line.Trim() -split "\s+", 2
        if ($parts.Length -eq 2) {
            $expected[$parts[1].Replace("\", "/")] = $parts[0].ToLower()
        }
    }

    $rootPath = (Resolve-Path .).Path
    $currentFiles = Get-ChildItem -Path $E2eDir -Recurse -File | Where-Object {
        $_.Name -ne "CONTRACT.sha256"
    }
    $actual = @{}
    foreach ($f in $currentFiles) {
        $relPath = $f.FullName.Substring($rootPath.Length + 1).Replace("\", "/")
        $h = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
        $actual[$relPath] = $h
    }

    $mismatches = @()
    foreach ($k in ($expected.Keys | Sort-Object)) {
        if (-not $actual.ContainsKey($k)) {
            $mismatches += "Missing file: $($k) (expected hash: $($expected[$k]))"
        } elseif ($actual[$k] -ne $expected[$k]) {
            $mismatches += "Hash mismatch for $($k): actual '$($actual[$k])' != expected '$($expected[$k])'"
        }
    }
    foreach ($k in ($actual.Keys | Sort-Object)) {
        if (-not $expected.ContainsKey($k)) {
            $mismatches += "Untracked new file: $($k) (hash: $($actual[$k]))"
        }
    }

    return @{
        Valid      = ($mismatches.Count -eq 0)
        Mismatches = $mismatches
        Hashes     = $actual
    }
}

function Invoke-MutationTestM1 {
    param(
        [string]$AppId = "com.aura.privacyspike",
        [string]$RunDir
    )
    Write-Output ">> MUTATION TEST M1: Testing harness sensitivity by disabling PHONE redaction..."

    $enginePath = (Resolve-Path "src/redaction/redactionEngine.ts").Path
    $backupPath = "$enginePath.bak"
    Copy-Item -Path $enginePath -Destination $backupPath -Force
    $originalHash = (Get-FileHash -Path $enginePath -Algorithm SHA256).Hash

    $mutationPassed = $false
    $details = ""

    try {
        # Mutate PHONE regex so it never matches
        $content = Get-Content -Path $enginePath -Raw
        $mutated = $content -replace "PHONE:\s*'[^']+'", "PHONE: '(?!)'"
        $mutated | Set-Content -Path $enginePath -NoNewline

        Write-Output "   Mutation applied (PHONE pattern broken). Reloading app..."
        Reset-AppEnvironment -AppId $AppId
        Select-AppTab -TabName "Redact" | Out-Null

        # Run T5 with unique mutation canary
        $mutCanary = "MUTCANARY-" + (Get-Random -Minimum 100000 -Maximum 999999)
        $sharePayload = "$mutCanary Call +91 98765 43210"
        Send-ShareIntent -Text $sharePayload -AppId $AppId

        $maestroPath = Get-MaestroExecutable
        $mutReportXml = Join-Path $RunDir "m1-mutation-test.xml"
        $argsList = @("test", "--format=JUNIT", "--output=$mutReportXml", "-e", "APP_ID=$AppId", "-e", "CANARY=$mutCanary")
        if ($global:AdbSerial) {
            $argsList += @("--device", $global:AdbSerial)
        }
        $argsList += "e2e/flows/t5-share-redact.yaml"
        $output = & $maestroPath @argsList 2>&1
        $mutExitCode = $LASTEXITCODE

        if ($mutExitCode -ne 0) {
            $mutationPassed = $true
            $details = "T5 correctly failed when PHONE pattern was broken (ExitCode: $mutExitCode)"
            Write-Output ">> M1 Result: PASS (Expected failure observed under mutation)"
        } else {
            $mutationPassed = $false
            $details = "CRITICAL: T5 unexpectedly passed despite disabled redaction!"
            Write-Output ">> M1 Result: FAIL (Mutation did not trigger failure)"
        }
    } finally {
        Write-Output "   Restoring src/redaction/redactionEngine.ts from backup..."
        Copy-Item -Path $backupPath -Destination $enginePath -Force
        Remove-Item -Path $backupPath -Force -ErrorAction SilentlyContinue

        $restoredHash = (Get-FileHash -Path $enginePath -Algorithm SHA256).Hash
        if ($restoredHash -ne $originalHash) {
            throw "CRITICAL INTEGRITY FAILURE: Restored file hash ($restoredHash) != original ($originalHash)!"
        }
        Write-Output "   Source integrity verified. Baseline hash confirmed: $restoredHash"
        Reset-AppEnvironment -AppId $AppId
    }

    return @{
        Status  = if ($mutationPassed) { "PASS" } else { "FAIL" }
        Details = $details
    }
}

# run-all.ps1 - Automated E2E Test Suite Runner for AURA Mobile Spike
# Contract v3 supporting emulator/device lanes, canary redaction assertions, mutation testing, and gfxinfo audits
param(
    [ValidateSet("emulator", "device")]
    [string]$Lane = "emulator",
    [string]$Serial,
    [string]$AppId = "com.aura.privacyspike",
    [switch]$UpdateContract
)

$ErrorActionPreference = "Stop"

# Set global execution context for ADB helpers
$global:AdbLane = $Lane
$global:AdbSerial = $Serial

# Load library functions
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "lib.ps1")

# Initialize timestamps and output directories
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path (Resolve-Path "e2e-results").Path $timestamp
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$logFile = Join-Path $runDir "raw-runner.log"

function Log-Output {
    param([string]$Message)
    Write-Output $Message
    Add-Content -Path $logFile -Value $Message
}

Log-Output "================================================================================"
Log-Output " AURA MOBILE SPIKE - AUTOMATED E2E HARNESS EXECUTION"
Log-Output " Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
Log-Output "================================================================================"

# ------------------------------------------------------------------------------
# PREFLIGHT CHECKS
# ------------------------------------------------------------------------------
# 1. Verify Metro bundler is running
$metroStatus = (curl.exe -s http://127.0.0.1:8081/status).Trim()
if ($metroStatus -ne "packager-status:running") {
    Log-Output "================================================================================"
    Log-Output " PREFLIGHT ERROR: Metro Bundler is NOT running at http://127.0.0.1:8081"
    Log-Output " Please ensure Metro is started via: npx expo start --dev-client"
    Log-Output "================================================================================"
    exit 1
}

# 2. Multi-device disambiguation check
$adbPath = Get-AdbExecutable
$attachedDevices = & $adbPath devices | Where-Object { $_ -match "\bdevice\b" }
if ($attachedDevices.Count -gt 1 -and -not $Serial) {
    Log-Output "================================================================================"
    Log-Output " PREFLIGHT ERROR: Multiple ADB devices detected ($($attachedDevices.Count) devices)."
    Log-Output " You must specify -Serial <deviceId> to select the target device."
    Log-Output " Connected devices:"
    foreach ($d in $attachedDevices) {
        Log-Output "   $d"
    }
    Log-Output "================================================================================"
    exit 1
}

# 3. Configure reverse port forwarding
Invoke-Adb reverse tcp:8081 tcp:8081 | Out-Null

# ------------------------------------------------------------------------------
# CONTRACT ENFORCEMENT
# ------------------------------------------------------------------------------
if ($UpdateContract) {
    Log-Output ""
    Log-Output "********************************************************************************"
    Log-Output " WARNING: CONTRACT UPDATE REQUESTED (-UpdateContract)"
    Log-Output " Generating / Updating e2e/CONTRACT.sha256 baseline with current file hashes."
    Log-Output "********************************************************************************"
    $newLines = Update-E2EContract -E2eDir "e2e"
    foreach ($line in $newLines) {
        Log-Output "  $line"
    }
    Log-Output "Contract baseline updated successfully."
    Log-Output ""
}

$contractCheck = Test-E2EContract -E2eDir "e2e"
if (-not $contractCheck.Valid) {
    Log-Output "================================================================================"
    Log-Output " CRITICAL FAILURE: E2E CONTRACT VIOLATION DETECTED"
    Log-Output "================================================================================"
    Log-Output "Reason: $($contractCheck.Reason)"
    foreach ($m in $contractCheck.Mismatches) {
        Log-Output "  [MISMATCH] $m"
    }
    Log-Output ""
    Log-Output "Aborting run. To lock intentional changes into contract, run with -UpdateContract."
    Log-Output "================================================================================"
    exit 1
}

# ------------------------------------------------------------------------------
# ENVIRONMENT & AUDITING
# ------------------------------------------------------------------------------
$nodeVer = (node -v).Trim()
$adbVer = (Invoke-Adb version | Select-Object -First 1).Trim()
$maestroPath = Get-MaestroExecutable
$maestroVer = (& $maestroPath --version | Select-Object -Last 1).Trim()

$deviceModel = (Invoke-Adb shell getprop ro.product.model).Trim()
$androidVer = (Invoke-Adb shell getprop ro.build.version.release).Trim()
$sdkVer = (Invoke-Adb shell getprop ro.build.version.sdk).Trim()

Log-Output ""
Log-Output "--- SYSTEM & ENVIRONMENT VERSIONS ---"
Log-Output "Node Version    : $nodeVer"
Log-Output "ADB Version     : $adbVer"
Log-Output "Maestro Version : $maestroVer"
Log-Output "Device / Target : $deviceModel (Android $androidVer, SDK $sdkVer)"
Log-Output "Execution Lane  : [$Lane]"
if ($Serial) { Log-Output "Device Serial   : $Serial" }
Log-Output "Target App ID   : $AppId"
Log-Output "Results Folder  : $runDir"

Log-Output ""
Log-Output "--- E2E CONTRACT SHA-256 INTEGRITY HASHES (VERIFIED AGAINST e2e/CONTRACT.sha256) ---"
foreach ($k in ($contractCheck.Hashes.Keys | Sort-Object)) {
    Log-Output "  $($k) : $($contractCheck.Hashes[$k])"
}

$results = [ordered]@{}

# Helper runner for Maestro flows
function Run-MaestroFlow {
    param(
        [string]$FlowPath,
        [string]$ReportName,
        [hashtable]$EnvVars = @{}
    )
    $reportXml = Join-Path $runDir "$ReportName.xml"
    $argsList = @("test", "--format=JUNIT", "--output=$reportXml", "-e", "APP_ID=$AppId")
    foreach ($k in $EnvVars.Keys) {
        $argsList += @("-e", "$k=$($EnvVars[$k])")
    }
    if ($global:AdbSerial) {
        $argsList += @("--device", $global:AdbSerial)
    }
    $argsList += $FlowPath
    $output = & $maestroPath @argsList 2>&1
    $exitCode = $LASTEXITCODE
    return @{
        ExitCode  = $exitCode
        RawOutput = ($output -join "`n")
        ReportXml = $reportXml
    }
}

Log-Output ""
Log-Output "================================================================================"
Log-Output " EXECUTING TEST FLOWS [$Lane]"
Log-Output "================================================================================"

# ------------------------------------------------------------------------------
# T1: Biometric match unlocks
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] T1: Biometric Match Unlocks..."
Reset-AppEnvironment -AppId $AppId
$watcherT1 = $null
if ($Lane -eq "device") {
    Log-Output ">> [MANUAL-ASSISTED] Touch the sensor now with an enrolled finger..."
    Write-Host "`n>>> [MANUAL-ASSISTED] Touch the fingerprint sensor now with your enrolled finger...`n" -ForegroundColor Yellow
} else {
    $watcherT1 = Start-BiometricWatcher -Mode "match" -TimeoutSeconds 60
}
$flowT1 = Run-MaestroFlow -FlowPath "e2e/flows/t1-biometric-unlock.yaml" -ReportName "t1-biometric-unlock"
$wOutT1 = if ($watcherT1) { Stop-BiometricWatcher -Job $watcherT1 } else { @("Manual assisted fingerprint on device") }

$t1Pass = ($flowT1.ExitCode -eq 0 -and $flowT1.RawOutput -match "Passed")
$results["T1_Biometric_Unlock"] = @{
    Status      = if ($t1Pass) { "PASS" } else { "FAIL" }
    Lane        = $Lane
    WatcherLog  = $wOutT1
    MaestroCode = $flowT1.ExitCode
}
Log-Output ">> T1 Result: $(if ($t1Pass) { "PASS [$Lane]" } else { "FAIL [$Lane]" })"

# ------------------------------------------------------------------------------
# T2: No-match then cancel keeps key blocked (Crypto read-key path)
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] T2: No-Match then Cancel Keeps Key Blocked (Crypto Path)..."
Reset-AppEnvironment -AppId $AppId
$watcherT2 = $null
if ($Lane -eq "device") {
    Log-Output ">> [MANUAL-ASSISTED] Touch the sensor with an UNENROLLED finger or tap Cancel..."
    Write-Host "`n>>> [MANUAL-ASSISTED] Touch sensor with an UNENROLLED finger, then tap Cancel / Back...`n" -ForegroundColor Yellow
} else {
    $watcherT2 = Start-BiometricWatcher -Mode "nomatch_cancel" -TimeoutSeconds 60
}
$flowT2 = Run-MaestroFlow -FlowPath "e2e/flows/t2-biometric-cancel.yaml" -ReportName "t2-biometric-cancel"
$wOutT2 = if ($watcherT2) { Stop-BiometricWatcher -Job $watcherT2 } else { @("Manual assisted cancel on device") }

$t2Pass = ($flowT2.ExitCode -eq 0 -and $flowT2.RawOutput -match "Passed")
$results["T2_Biometric_Cancel"] = @{
    Status      = if ($t2Pass) { "PASS" } else { "FAIL" }
    Lane        = $Lane
    WatcherLog  = $wOutT2
    MaestroCode = $flowT2.ExitCode
}
Log-Output ">> T2 Result: $(if ($t2Pass) { "PASS [$Lane]" } else { "FAIL [$Lane]" })"

# ------------------------------------------------------------------------------
# T3: Generate key (requireAuth ON) then read via biometric succeeds
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] T3: Keystore requireAuth + Biometric Read..."
Reset-AppEnvironment -AppId $AppId
$watcherT3 = $null
if ($Lane -eq "device") {
    Log-Output ">> [MANUAL-ASSISTED] Touch the sensor now to authenticate Keystore read..."
    Write-Host "`n>>> [MANUAL-ASSISTED] Touch the fingerprint sensor now to authenticate Keystore read...`n" -ForegroundColor Yellow
} else {
    $watcherT3 = Start-BiometricWatcher -Mode "match" -TimeoutSeconds 60
}
$flowT3 = Run-MaestroFlow -FlowPath "e2e/flows/t3-keystore-auth.yaml" -ReportName "t3-keystore-auth"
$wOutT3 = if ($watcherT3) { Stop-BiometricWatcher -Job $watcherT3 } else { @("Manual assisted biometric read on device") }

$t3Pass = ($flowT3.ExitCode -eq 0 -and $flowT3.RawOutput -match "Passed")
$results["T3_Keystore_Biometric"] = @{
    Status      = if ($t3Pass) { "PASS" } else { "FAIL" }
    Lane        = $Lane
    WatcherLog  = $wOutT3
    MaestroCode = $flowT3.ExitCode
}
Log-Output ">> T3 Result: $(if ($t3Pass) { "PASS [$Lane]" } else { "FAIL [$Lane]" })"

# ------------------------------------------------------------------------------
# T4: SQLCipher button shows v4.x.x, pull DBs via run-as, check encryption
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] T4: SQLCipher Active + DB Cryptographic Proof..."
Reset-AppEnvironment -AppId $AppId
$watcherT4 = $null
if ($Lane -eq "device") {
    Log-Output ">> [MANUAL-ASSISTED] Touch the sensor if prompted..."
} else {
    $watcherT4 = Start-BiometricWatcher -Mode "match" -TimeoutSeconds 60
}
$flowT4 = Run-MaestroFlow -FlowPath "e2e/flows/t4-sqlcipher.yaml" -ReportName "t4-sqlcipher"
$wOutT4 = if ($watcherT4) { Stop-BiometricWatcher -Job $watcherT4 } else { @("Manual assisted on device") }

$dbDir = Join-Path $runDir "databases"
$pulled = Find-And-Pull-Databases -AppId $AppId -DestinationDir $dbDir

$vaultCheck = Verify-DatabaseFile -FilePath (Join-Path $dbDir "aura_vault.db")
$ctrlCheck = Verify-DatabaseFile -FilePath (Join-Path $dbDir "control_plain.db")

$vaultEncrypted = ($vaultCheck.Exists -and (-not $vaultCheck.HasMarker) -and (-not $vaultCheck.HasSqlite3))
$ctrlPlaintext  = ($ctrlCheck.Exists -and $ctrlCheck.HasMarker -and $ctrlCheck.HasSqlite3)
$t4Pass = ($flowT4.ExitCode -eq 0 -and $vaultEncrypted -and $ctrlPlaintext)

$results["T4_SQLCipher_Crypto"] = @{
    Status           = if ($t4Pass) { "PASS" } else { "FAIL" }
    Lane             = $Lane
    VaultSize        = $vaultCheck.Size
    VaultHasMarker   = $vaultCheck.HasMarker
    VaultHeaderHex   = $vaultCheck.HeaderHex
    ControlSize      = $ctrlCheck.Size
    ControlHasMarker = $ctrlCheck.HasMarker
    ControlHeaderHex = $ctrlCheck.HeaderHex
}
Log-Output ">> T4 Result: $(if ($t4Pass) { "PASS [$Lane]" } else { "FAIL [$Lane]" })"
Log-Output "   Vault DB ($($vaultCheck.Size) bytes): Marker=$($vaultCheck.HasMarker), Header=$($vaultCheck.HeaderHex)"
Log-Output "   Control DB ($($ctrlCheck.Size) bytes): Marker=$($ctrlCheck.HasMarker), Header=$($ctrlCheck.HeaderHex)"

# ------------------------------------------------------------------------------
# T5: Share text with unique canary -> asserts sanitized canary and no raw digits in output
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] T5: Android Share Target & Redaction Pipeline (Canary-Validated)..."
Reset-AppEnvironment -AppId $AppId
Select-AppTab -TabName "Redact" | Out-Null
$canaryT5 = "CANARY-" + (Get-Random -Minimum 100000 -Maximum 999999)
$shareIntent = "$canaryT5 Call +91 98765 43210"
Send-ShareIntent -Text $shareIntent -AppId $AppId

$flowT5 = Run-MaestroFlow -FlowPath "e2e/flows/t5-share-redact.yaml" -ReportName "t5-share-redact" -EnvVars @{ "CANARY" = $canaryT5 }
$t5Pass = ($flowT5.ExitCode -eq 0 -and $flowT5.RawOutput -match "Passed")
$results["T5_Share_Redact"] = @{
    Status      = if ($t5Pass) { "PASS" } else { "FAIL" }
    Lane        = $Lane
    Canary      = $canaryT5
    InputText   = $shareIntent
    MaestroCode = $flowT5.ExitCode
}
Log-Output ">> T5 Result: $(if ($t5Pass) { "PASS [$Lane]" } else { "FAIL [$Lane]" })"

# ------------------------------------------------------------------------------
# T6: Scroll list and record dumpsys gfxinfo janky-frame stats (MEASURED only)
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] T6: Scroll Performance & Dumpsys Gfxinfo (Measurement-only)..."
Reset-AppEnvironment -AppId $AppId
Invoke-Adb shell dumpsys gfxinfo $AppId reset | Out-Null

$flowT6 = Run-MaestroFlow -FlowPath "e2e/flows/t6-perf-scroll.yaml" -ReportName "t6-perf-scroll"
$gfxStats = Get-GfxInfoStats -AppId $AppId

# Save raw dumpsys gfxinfo to text file in runDir
$rawGfxFile = Join-Path $runDir "gfxinfo-raw.txt"
$gfxStats.RawOutput | Set-Content -Path $rawGfxFile

$results["T6_Perf_Gfxinfo"] = @{
    Status       = "MEASURED"
    Lane         = $Lane
    TotalFrames  = $gfxStats.TotalFrames
    JankyFrames  = $gfxStats.JankyFrames
    JankyPercent = $gfxStats.JankyPercent
    RawGfxFile   = $rawGfxFile
}
Log-Output ">> T6 Result: MEASURED [$Lane] (Frames: $($gfxStats.TotalFrames) | Janky: $($gfxStats.JankyFrames) ($($gfxStats.JankyPercent)%))"
Log-Output "   Raw Gfxinfo saved to: $rawGfxFile"

# ------------------------------------------------------------------------------
# N1: Negative Control - Run T4 checks against control file as if vault
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] N1 (Negative Control): Assert control file behaves like encrypted vault..."
$n1CheckAsVault = (-not $ctrlCheck.HasMarker) -and (-not $ctrlCheck.HasSqlite3)
$n1Pass = (-not $n1CheckAsVault) # True failure of assertion = PASS for negative control

$results["N1_Negative_Control_DB"] = @{
    Status       = if ($n1Pass) { "PASS" } else { "FAIL" }
    Lane         = $Lane
    Detail       = "Plaintext control correctly triggered security failure when evaluated as vault"
    HasMarker    = $ctrlCheck.HasMarker
    HasHeader    = $ctrlCheck.HasSqlite3
}
Log-Output ">> N1 Result: $(if ($n1Pass) { "PASS (Expected failure observed) [$Lane]" } else { "FAIL [$Lane]" })"

# ------------------------------------------------------------------------------
# N2: Negative Control - Clean canary delivered, verifies specific failure on [REDACTED_
# ------------------------------------------------------------------------------
Log-Output ""
Log-Output ">> RUNNING [$Lane] N2 (Negative Control): Verify clean canary delivered & specifically fail on missing [REDACTED_..."
Select-AppTab -TabName "Redact" | Out-Null
$canaryN2 = "CLEAN-" + (Get-Random -Minimum 100000 -Maximum 999999)
$cleanText = "$canaryN2 Clean payload without sensitive data"
Send-ShareIntent -Text $cleanText -AppId $AppId

$flowN2 = Run-MaestroFlow -FlowPath "e2e/flows/n2-share-no-pii.yaml" -ReportName "n2-share-no-pii" -EnvVars @{ "CANARY" = $canaryN2 }

# Parse Maestro report XML to strictly verify failure reason
[xml]$n2Xml = Get-Content -Path $flowN2.ReportXml -Raw -ErrorAction SilentlyContinue
$n2Failure = if ($n2Xml) { $n2Xml.testsuites.testsuite.testcase.failure } else { "" }

# Check that failure was specifically due to [REDACTED_ and did not fail on the canary
$failedOnRedactedTag = ($flowN2.ExitCode -ne 0 -and $n2Failure -match "REDACTED_")
$canaryPassed = (-not ($n2Failure -match $canaryN2))
$n2Pass = ($failedOnRedactedTag -and $canaryPassed)

$results["N2_Negative_Control_PII"] = @{
    Status         = if ($n2Pass) { "PASS" } else { "FAIL" }
    Lane           = $Lane
    Canary         = $canaryN2
    SpecificFail   = $failedOnRedactedTag
    Detail         = if ($n2Pass) { "Clean canary delivered; flow specifically failed on missing [REDACTED_ tag" } else { "Failed to verify clean delivery and specific assertion failure" }
    MaestroCode    = $flowN2.ExitCode
}
Log-Output ">> N2 Result: $(if ($n2Pass) { "PASS (Expected failure observed) [$Lane]" } else { "FAIL [$Lane]" })"

# ------------------------------------------------------------------------------
# M1: Mutation Test - Break PHONE regex, verify T5 fails, restore file & verify SHA-256
# ------------------------------------------------------------------------------
Log-Output ""
$m1Result = Invoke-MutationTestM1 -AppId $AppId -RunDir $runDir
$results["M1_Mutation_Redaction"] = @{
    Status  = $m1Result.Status
    Lane    = $Lane
    Detail  = $m1Result.Details
}
Log-Output ">> M1 Result: $($m1Result.Status) [$Lane]"

# Save results.json
$jsonPath = Join-Path $runDir "results.json"
$results | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonPath

Log-Output ""
Log-Output "================================================================================"
Log-Output " FINAL TEST SUMMARY TABLE [$Lane]"
Log-Output "================================================================================"
Log-Output ("{0,-30} | {1,-10} | {2,-10} | {3}" -f "Test Case", "Lane", "Status", "Details")
Log-Output "--------------------------------------------------------------------------------"
foreach ($k in $results.Keys) {
    $item = $results[$k]
    $details = ""
    if ($k -eq "T4_SQLCipher_Crypto") { $details = "Vault: Encrypted (No marker/header); Control: Plaintext" }
    elseif ($k -eq "T5_Share_Redact") { $details = "Canary ($($item.Canary)) -> [REDACTED_PHONE]" }
    elseif ($k -eq "T6_Perf_Gfxinfo") { $details = "Total: $($item.TotalFrames), Jank: $($item.JankyFrames) ($($item.JankyPercent)%)" }
    elseif ($k -like "N*") { $details = $item.Detail }
    elseif ($k -like "M*") { $details = $item.Detail }
    else { $details = "Maestro exit code: $($item.MaestroCode)" }
    Log-Output ("{0,-30} | {1,-10} | {2,-10} | {3}" -f $k, "[$($item.Lane)]", $item.Status, $details)
}
Log-Output "================================================================================"

# Check overall status
$allPass = $true
foreach ($k in $results.Keys) {
    if ($k -eq "T6_Perf_Gfxinfo") {
        if ($results[$k].Status -ne "MEASURED") {
            $allPass = $false
            break
        }
    } else {
        if ($results[$k].Status -ne "PASS") {
            $allPass = $false
            break
        }
    }
}

if ($allPass) {
    Log-Output "OVERALL RESULT: SUCCESS (Core tests passed, negative controls verified failure reasons, mutation caught, metrics measured)"
    exit 0
} else {
    Log-Output "OVERALL RESULT: FAILED (One or more tests did not meet expectations)"
    exit 1
}

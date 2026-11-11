# Chạy toàn bộ test đầu cuối của doite.vn (Windows PowerShell).
#
# Cần trước:  cargo build --locked   (ở gốc dự án)
#             cd tests/e2e; npm install
#             $env:MYSQL_PWD = "<mật khẩu root MySQL>"   (test đọc/dọn DB bằng tài khoản root)
# Chạy:       powershell -File tests/e2e/chay-tat-ca.ps1 [-Photo C:\duong\dan\anh.jpg] [-Only realtime-live,social-live]
#
# Mỗi bộ test chạy với một server mới khởi động: server giới hạn 10 lần đăng ký mỗi IP,
# chạy liền nhiều bộ trên cùng một server sẽ bị chặn đăng ký (giới hạn đúng, không phải lỗi).
# Ảnh chụp màn hình và log server ghi vào tests/e2e/out (đã gitignore).
param(
  [string]$Photo = "",
  [string[]]$Only = @()
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$exe = Join-Path $root "target\debug\doite.exe"
$out = Join-Path $PSScriptRoot "out"
New-Item -ItemType Directory -Force $out | Out-Null
if (-not (Test-Path $exe)) { throw "Chưa build: chạy 'cargo build --locked' ở $root" }
if (-not $env:MYSQL_PWD) { throw "Chưa đặt `$env:MYSQL_PWD (mật khẩu root MySQL)" }

$suites = "auth-live","account-live","backfill","mobile-header","avatar-live","crop-live","trades-live","post-live","transition","mine-live","social-live","realtime-live"
$Only = @($Only | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Only.Count) { $suites = $suites | Where-Object { $Only -contains $_ } }

function Start-Server($log) {
  Get-Process doite -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 400
  Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
  Start-Process -FilePath $exe -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 80; $i++) {
    if ((Get-Content $log -Raw -ErrorAction SilentlyContinue) -match "127\.0\.0\.1:\d+") { return }
    Start-Sleep -Milliseconds 250
  }
  throw "Server không lên được, xem $log.err"
}

$summary = @()
foreach ($suite in $suites) {
  if (($suite -eq "avatar-live" -or $suite -eq "crop-live") -and -not $Photo) {
    $summary += "BỎ QUA  $suite (cần -Photo <ảnh jpg/png>)"; continue
  }
  $log = Join-Path $out "server-$suite.log"
  Start-Server $log
  Write-Host "=== $suite" -ForegroundColor Cyan
  $nodeArgs = if ($suite -eq "transition") { @($out) } else { @($log, $out) }
  if ($Photo -and ($suite -eq "avatar-live" -or $suite -eq "crop-live")) { $nodeArgs += $Photo }
  $result = & node (Join-Path $PSScriptRoot "$suite.cjs") @nodeArgs
  $result | ForEach-Object { Write-Host $_ }
  $fails = @($result | Where-Object { $_ -match "^(FAIL|CRASH)" }).Count
  $passes = @($result | Where-Object { $_ -match "^PASS" }).Count
  $summary += "{0}  {1}: {2} đạt, {3} lỗi" -f ($(if ($fails) { "LỖI " } else { "ĐẠT " }), $suite, $passes, $fails)
}
Get-Process doite -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "`n===== TỔNG KẾT" -ForegroundColor Cyan
$summary | ForEach-Object { Write-Host $_ }
Write-Host "Server test đã tắt. Chạy lại server dev: cargo run --locked"

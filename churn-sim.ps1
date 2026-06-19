# ╔══════════════════════════════════════════════════════════════╗
# ║  churn-sim.ps1 — PowerShell wrapper chạy Churn Simulation   ║
# ╚══════════════════════════════════════════════════════════════╝
#
# CÁCH DÙNG:
#   1. Mở Terminal 1: cd bootstrap-server; node server.js
#   2. Mở Terminal 2: cd peer-node; node broadcaster.js
#   3. Mở Terminal 3: .\churn-sim.ps1
#
# TÙY CHỌN:
#   .\churn-sim.ps1 -Rounds 5
#   .\churn-sim.ps1 -Rounds 3 -Bootstrap "http://127.0.0.1:3000"

param(
  [int]    $Rounds    = 3,
  [string] $Bootstrap = "http://127.0.0.1:3000",
  [int]    $Online    = 8000,
  [int]    $Offline   = 5000
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  CHURN SIMULATION — P2P Chat System                       ║" -ForegroundColor Cyan
Write-Host "║  Mô phỏng peer liên tục Join/Leave để kiểm tra độ bền     ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tham số:" -ForegroundColor White
Write-Host "  Số vòng        : $Rounds" -ForegroundColor Gray
Write-Host "  Bootstrap URL  : $Bootstrap" -ForegroundColor Gray
Write-Host "  Thời gian online: $($Online/1000)s/vòng" -ForegroundColor Gray
Write-Host "  Thời gian pause : $($Offline/1000)s/vòng" -ForegroundColor Gray
Write-Host ""

# Kiểm tra Node.js có tồn tại không
try {
  $nodeVersion = node --version 2>&1
  Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
} catch {
  Write-Host "[ERROR] Node.js không tìm thấy. Hãy cài Node.js trước." -ForegroundColor Red
  exit 1
}

# Kiểm tra churn-sim.js tồn tại
$churnScript = Join-Path $scriptDir "churn-sim.js"
if (-not (Test-Path $churnScript)) {
  Write-Host "[ERROR] Không tìm thấy churn-sim.js tại: $churnScript" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Đang chạy Churn Simulation..." -ForegroundColor Yellow
Write-Host ""

# Chạy churn-sim.js với tham số
node $churnScript `
  --rounds    $Rounds `
  --bootstrap $Bootstrap `
  --online    $Online `
  --offline   $Offline

# Kết quả
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Churn Simulation hoàn thành thành công!" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Churn Simulation kết thúc với lỗi (code: $LASTEXITCODE)" -ForegroundColor Red
}

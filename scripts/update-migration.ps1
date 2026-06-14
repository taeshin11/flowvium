# update-migration.ps1 — 이전(migration) 패키지 1-커맨드 갱신
#   G:\내 드라이브\0.flowvium_move 의 코드번들·DB·secrets·config·메모리를 현 상태로 refresh.
#   사용: powershell -File scripts\update-migration.ps1   (또는 -Dst "다른경로")
#   변경 사항(코드 commit/push, DB 학습 누적, 키 갱신) 있을 때마다 실행.
param(
  [string]$Src = "C:\NoAddsMakingApps\FlowVium",
  [string]$Dst = "G:\내 드라이브\0.flowvium_move"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Dst)) { Write-Error "대상 경로 없음: $Dst"; exit 1 }
Set-Location $Src
foreach ($d in "secrets","data","config","code-backup","claude-memory") {
  $p = Join-Path $Dst $d; if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

Write-Output "[1/5] 코드 번들 (git --all) ..."
$bundle = Join-Path $Dst "code-backup\flowvium-full.bundle"
git bundle create $bundle --all 2>&1 | Select-Object -Last 1
$headFile = Join-Path $Dst "code-backup\HEAD-commit.txt"
git log -1 --format="%H %s" | Set-Content -LiteralPath $headFile
git remote -v | Select-Object -First 1 | Add-Content -LiteralPath $headFile
$ahead = git rev-list --count "origin/master..HEAD" 2>$null
Add-Content -LiteralPath $headFile "updated: $(git log -1 --format='%cI') | 미푸시 ahead: $ahead"
if ($ahead -ne "0") { Write-Warning "⚠️ 미푸시 커밋 $ahead 개 — git push origin master 권장(번들엔 포함됨)" }

Write-Output "[2/5] DB 일관 스냅샷 (.backup + WAL checkpoint) ..."
foreach ($f in "flowvium.db-wal","flowvium.db-shm") { $p = Join-Path $Dst "data\$f"; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }
$dbDst = (Join-Path $Dst "data\flowvium.db") -replace '\\','/'
node -e "const D=require('better-sqlite3'); const db=new D('data/flowvium.db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.backup('$dbDst').then(()=>{console.log('  DB 스냅샷 OK'); db.close();}).catch(e=>{console.error('  DB backup 실패:',e.message); db.close(); process.exit(1);});"

Write-Output "[3/5] secrets (env·tunnel token) ..."
Copy-Item "$Src\.env.local" (Join-Path $Dst "secrets\.env.local") -Force
Copy-Item "$Src\.cf-tunnel-token" (Join-Path $Dst "secrets\.cf-tunnel-token") -Force

Write-Output "[4/5] config (ecosystem·ollama·Task Scheduler) ..."
if (Test-Path "$Src\ecosystem.config.cjs") { Copy-Item "$Src\ecosystem.config.cjs" (Join-Path $Dst "config\ecosystem.config.cjs") -Force }
ollama list > (Join-Path $Dst "config\ollama-models.txt") 2>&1
foreach ($t in "FlowVium-Morning","FlowVium-Noon","FlowVium-Afternoon","FlowVium-Evening","FlowVium-Midnight","FlowVium-Backup") {
  try { schtasks /query /tn $t /xml > (Join-Path $Dst "config\task-$t.xml") 2>$null } catch {}
}

Write-Output "[5/5] Claude 메모리 ..."
$mem = "C:\Users\$env:USERNAME\.claude\projects\C--NoAddsMakingApps-FlowVium\memory"
if (Test-Path -LiteralPath $mem) { Copy-Item "$mem\*" (Join-Path $Dst "claude-memory") -Recurse -Force }

# 검증 요약
$head = git log -1 --format="%h %s"
Write-Output ""
Write-Output "✅ 패키지 갱신 완료 — HEAD: $head"
node -e "const D=require('better-sqlite3'); const db=new D('$dbDst',{readonly:true}); console.log('   DB: recommendations', db.prepare('SELECT COUNT(*) c FROM recommendations').get().c, '| evidence_claims', db.prepare('SELECT COUNT(*) c FROM evidence_claims').get().c); db.close();" 2>$null
Write-Output "   대상: $Dst"

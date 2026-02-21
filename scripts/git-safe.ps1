param(
  [Parameter(Mandatory=$true)][string]$msg,
  [string]$branch = "main",
  [string]$remote = "origin",

  # ОБЯЗАТЕЛЬНО: список файлов для коммита (закрывает риск "захватил лишнее")
  [Parameter(Mandatory=$true)][string[]]$files,

  # ЛИМИТ файлов (по умолчанию 2, чтобы соблюдать "один шаг/минимальный diff")
  [int]$maxFiles = 2,

  # Команда тест-гейта (можно расширить позже, но по умолчанию только инвариантный тест)
  [string]$testCmd = "npm test -- tests/owner/01-owner-money-invariants.test.js"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path .git)) { throw "Not a git repo" }

# 0) Ensure remote exists
git remote get-url $remote *> $null
if ($LASTEXITCODE -ne 0) { throw "Remote '$remote' not found" }

# 1) Branch safety
$cur = (git rev-parse --abbrev-ref HEAD).Trim()
if ($cur -ne $branch) { throw "Not on '$branch' (current: $cur). Aborting." }

# 2) Sync safety: forbid pushing if behind remote
git fetch $remote $branch *> $null
$local = (git rev-parse $branch).Trim()
$up = (git rev-parse $remote/$branch).Trim()
$base = (git merge-base $branch $remote/$branch).Trim()
if ($local -ne $up) {
  if ($local -eq $base) { throw "Local branch is BEHIND $remote/$branch. Pull/rebase first." }
}

# 3) File count limit
if ($files.Count -gt $maxFiles) {
  throw "Too many files ($($files.Count)) staged request. Max allowed: $maxFiles. Use smaller diff."
}

# 4) Block-list patterns (even if tracked)
$blockedPatterns = @(
  '^database\.sqlite(\..*)?$',
  '^server\\database\.sqlite(\..*)?$',
  '^\.env(\..*)?$',
  '^.*\.log$',
  '^_diag_.*$'
)

# 5) Validate files exist + not blocked
foreach ($f in $files) {
  if (-not (Test-Path $f)) { throw "File not found: $f" }
  foreach ($pat in $blockedPatterns) {
    if ($f -match $pat) { throw "Blocked file requested: $f" }
  }
}

# 6) Gate tests (must pass)
Write-Host "Running test gate: $testCmd"
cmd /c $testCmd
if ($LASTEXITCODE -ne 0) { throw "Tests failed. Aborting commit/push." }

# 7) Stage ONLY given files
git reset *> $null
git add -- $files

# Ensure something staged
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { throw "Nothing staged." }

# 8) Re-check: no blocked files staged
$staged = (git diff --cached --name-only)
foreach ($sf in $staged) {
  foreach ($pat in $blockedPatterns) {
    if ($sf -match $pat) { throw "Blocked file staged: $sf" }
  }
}

# 9) Secret scan on staged diff (basic patterns)
$diff = (git diff --cached)
$secretHits = @(
  'Authorization:\s*Bearer\s+[A-Za-z0-9\-\._]+',
  'api[_-]?key\s*[:=]\s*.+',
  'secret\s*[:=]\s*.+',
  'password\s*[:=]\s*.+',
  'BEGIN\s+(RSA|OPENSSH|EC)\s+PRIVATE\s+KEY'
)
foreach ($re in $secretHits) {
  if ($diff -match $re) { throw "Possible secret detected in staged diff (pattern: $re). Aborting." }
}

# 10) Show what will be committed (non-interactive transparency)
Write-Host ""
Write-Host "STAGED FILES:"
$staged | ForEach-Object { Write-Host " - $_" }
Write-Host ""

# 11) Commit + push
git commit -m "$msg"
git push $remote $branch

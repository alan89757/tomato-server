$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw '构建失败' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $stage = Join-Path $projectRoot "artifacts/fc-$stamp"
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Copy-Item -LiteralPath package.json,pnpm-lock.yaml -Destination $stage
  $workspace = (Get-Content pnpm-workspace.yaml -Raw) + "`nnodeLinker: hoisted`n"
  [IO.File]::WriteAllText((Join-Path $stage 'pnpm-workspace.yaml'), $workspace)
  Copy-Item -LiteralPath dist -Destination $stage -Recurse
  New-Item -ItemType Directory -Path (Join-Path $stage 'scripts'),(Join-Path $stage 'sql') | Out-Null
  Copy-Item -LiteralPath scripts/db-utils.mjs,scripts/migrate.mjs,scripts/smoke-local.mjs -Destination (Join-Path $stage 'scripts')
  Get-ChildItem sql -Filter '*.sql' -File | Copy-Item -Destination (Join-Path $stage 'sql')
  Push-Location $stage
  try {
    & pnpm install --prod --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw '生产依赖安装失败' }
    $links = Get-ChildItem node_modules -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
    if ($links) { throw '部署包包含符号链接，停止打包' }
    $native = Get-ChildItem node_modules -Recurse -Filter '*.node'
    if ($native) { throw '检测到原生二进制依赖，请在 Linux 构建部署包' }
    $zip = "$stage.zip"
    & tar.exe -a -c -f $zip dist node_modules package.json scripts sql
    if ($LASTEXITCODE -ne 0) { throw 'ZIP 打包失败' }
    Write-Host "FC ZIP: $zip"
    Write-Host '启动命令: node dist/main.js；监听端口: 3000；HOST=0.0.0.0；PORT=3000'
    Get-FileHash -LiteralPath $zip -Algorithm SHA256
  } finally { Pop-Location }
} finally { Pop-Location }

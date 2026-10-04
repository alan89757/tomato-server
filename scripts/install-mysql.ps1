param([string]$Version = '8.4.11')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path $PSScriptRoot -Parent
$installRoot = Join-Path $env:ProgramFiles "MySQL\mysql-$Version-winx64"
$stateRoot = Join-Path $env:ProgramData 'MySQL\TomatoMySQL84'
$dataRoot = Join-Path $stateRoot 'data'
$configPath = Join-Path $stateRoot 'my.ini'
$serviceName = 'TomatoMySQL84'
$envPath = Join-Path $projectRoot '.env'
if (Test-Path $envPath) { throw '已有 .env，停止安装以免覆盖已有连接配置。' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin) { throw '请在管理员 PowerShell 中运行本脚本（需注册 Windows 服务并写入 Program Files）。' }
if (Test-Path (Join-Path $stateRoot 'admin.cnf')) { throw '检测到已配置的数据库。为保护已有数据，请直接启动服务，不要重复安装。' }
$existing = Get-Service $serviceName -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') { throw '现有同名服务正在运行；请先核查其数据，脚本不会替换运行中的服务。' }
if ($existing) {
  $oldImage = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName").ImagePath
  if ($oldImage -notlike "$projectRoot\.local-tools\mysql\*") { throw '同名服务属于其他安装，停止自动替换。' }
  $oldData = Join-Path $projectRoot '.local-tools\mysql\data'
  if (Test-Path $oldData) { throw '旧安装仍存在数据，请先迁移；不会创建空数据库替换它。' }
}
if ((Test-Path $dataRoot) -and (Get-ChildItem $dataRoot -Force | Select-Object -First 1)) { throw '数据目录非空；停止以免影响现有数据库。' }
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
& icacls.exe $stateRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "$($identity.Name):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '无法限制数据库目录权限' }
$mysqld = Join-Path $installRoot 'bin\mysqld.exe'
if (!(Test-Path $mysqld)) {
  $archive = Join-Path $env:TEMP "mysql-$Version-winx64.zip"
  if (!(Test-Path $archive)) {
    Invoke-WebRequest "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-$Version-winx64.zip" -OutFile $archive -TimeoutSec 1200
  }
  if ($Version -ne '8.4.11' -or (Get-FileHash $archive -Algorithm MD5).Hash.ToLower() -ne '2e833921898a9a030ea6bfe81bd811bc') { throw '下载校验失败，请核查 Oracle 官方下载页。' }
  New-Item -ItemType Directory -Force -Path (Split-Path $installRoot -Parent) | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath (Split-Path $installRoot -Parent)
}
$ini = @"
[mysqld]
basedir=$($installRoot.Replace('\','/'))
datadir=$($dataRoot.Replace('\','/'))
port=3306
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone=+00:00
log-error=$($stateRoot.Replace('\','/'))/mysql-error.log
[client]
host=127.0.0.1
port=3306
default-character-set=utf8mb4
"@
[IO.File]::WriteAllText($configPath, $ini, [Text.UTF8Encoding]::new($false))
& $mysqld "--defaults-file=$configPath" --initialize-insecure --console
if ($LASTEXITCODE -ne 0) { throw 'MySQL 初始化失败' }
if ($existing) {
  $binaryPath = '"' + $mysqld + '" --defaults-file="' + $configPath + '" ' + $serviceName
  & sc.exe config $serviceName binPath= $binaryPath start= auto
} else { & $mysqld --install $serviceName "--defaults-file=$configPath" }
if ($LASTEXITCODE -ne 0) { throw 'MySQL 服务注册失败' }
Set-Service $serviceName -StartupType Automatic
Start-Service $serviceName
$rootPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$appPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$sql = "ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPassword'; CREATE DATABASE IF NOT EXISTS tomato_todo CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER 'tomato_app'@'127.0.0.1' IDENTIFIED BY '$appPassword'; GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON tomato_todo.* TO 'tomato_app'@'127.0.0.1';"
$sql | & (Join-Path $installRoot 'bin\mysql.exe') '--protocol=TCP' '--host=127.0.0.1' '--user=root' '--connect-timeout=30'
if ($LASTEXITCODE -ne 0) { throw 'MySQL 用户配置失败' }
$adminConfig = "[client]`nuser=root`npassword=$rootPassword`nhost=127.0.0.1`nport=3306`n"
[IO.File]::WriteAllText((Join-Path $stateRoot 'admin.cnf'), $adminConfig, [Text.UTF8Encoding]::new($false))
$appConfig = "NODE_ENV=development`nHOST=0.0.0.0`nPORT=3000`nDB_HOST=127.0.0.1`nDB_PORT=3306`nDB_USER=tomato_app`nDB_PASSWORD=$appPassword`nDB_NAME=tomato_todo`nCORS_ORIGINS=http://localhost:8081,http://127.0.0.1:8081`nAPI_KEY=`n"
[IO.File]::WriteAllText($envPath, $appConfig, [Text.UTF8Encoding]::new($false))
Write-Output "MySQL $Version 已配置。服务：$serviceName；程序：$installRoot；数据：$dataRoot；管理员凭据：$stateRoot\admin.cnf；应用凭据：.env（未输出密码）。"

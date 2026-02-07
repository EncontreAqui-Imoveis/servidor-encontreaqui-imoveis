param(
  [string]$EnvPath = ".env",
  [string]$SqlPath = "scripts\reset_db.sql"
)

function Get-EnvValue([string]$name, [string]$content) {
  $match = [regex]::Match($content, "(?m)^${name}=(.*)$")
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

if (!(Test-Path $EnvPath)) {
  throw "Arquivo .env nao encontrado em: $EnvPath"
}
if (!(Test-Path $SqlPath)) {
  throw "Arquivo SQL nao encontrado em: $SqlPath"
}

$content = Get-Content -Raw -Path $EnvPath
$dbHost = Get-EnvValue -name "DB_HOST" -content $content
$port = Get-EnvValue -name "DB_PORT" -content $content
$user = Get-EnvValue -name "DB_USER" -content $content
$pass = Get-EnvValue -name "DB_PASSWORD" -content $content
$db = Get-EnvValue -name "DB_DATABASE" -content $content

if (!$dbHost -or !$port -or !$user -or !$pass -or !$db) {
  throw "Variaveis DB_* incompletas no .env"
}

$mysqlCmd = "mysql -h $dbHost -P $port -u $user -p$pass $db < $SqlPath"
Write-Host "Executando reset do banco..."
Write-Host "Comando: $mysqlCmd"
cmd /c $mysqlCmd

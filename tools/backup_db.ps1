param(
  [string]$EnvPath = ".env",
  [string]$OutputPath = "backup_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".sql"
)

function Get-EnvValue([string]$name, [string]$content) {
  $match = [regex]::Match($content, "(?m)^${name}=(.*)$")
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

if (!(Test-Path $EnvPath)) {
  throw "Arquivo .env nao encontrado em: $EnvPath"
}

$content = Get-Content -Raw -Path $EnvPath
$host = Get-EnvValue -name "DB_HOST" -content $content
$port = Get-EnvValue -name "DB_PORT" -content $content
$user = Get-EnvValue -name "DB_USER" -content $content
$pass = Get-EnvValue -name "DB_PASSWORD" -content $content
$db = Get-EnvValue -name "DB_DATABASE" -content $content

if (!$host -or !$port -or !$user -or !$pass -or !$db) {
  throw "Variaveis DB_* incompletas no .env"
}

$dumpCmd = "mysqldump -h $host -P $port -u $user -p$pass $db > $OutputPath"
Write-Host "Gerando backup do banco..."
Write-Host "Comando: $dumpCmd"
cmd /c $dumpCmd

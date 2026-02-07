param(
  [Parameter(Mandatory = $true)][string]$CloudName,
  [Parameter(Mandatory = $true)][string]$ApiKey,
  [Parameter(Mandatory = $true)][string]$ApiSecret,
  [string]$EnvPath = ".env"
)

if (!(Test-Path $EnvPath)) {
  throw "Arquivo .env nao encontrado em: $EnvPath"
}

$content = Get-Content -Raw -Path $EnvPath

function Set-EnvVar([string]$name, [string]$value) {
  if ($content -match "(?m)^${name}=.*$") {
    $script:content = [regex]::Replace($content, "(?m)^${name}=.*$", "${name}=$value")
  } else {
    $script:content = $content.TrimEnd() + "`n${name}=$value`n"
  }
}

Set-EnvVar -name "CLOUDINARY_CLOUD_NAME" -value $CloudName
Set-EnvVar -name "CLOUDINARY_API_KEY" -value $ApiKey
Set-EnvVar -name "CLOUDINARY_API_SECRET" -value $ApiSecret

Set-Content -Path $EnvPath -Value $content -Encoding UTF8
Write-Host "Cloudinary atualizado em $EnvPath"

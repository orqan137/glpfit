$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $toolsDir = Join-Path $projectRoot '.tools'
    $uv = Join-Path $toolsDir 'uv.exe'
    if (-not (Test-Path -LiteralPath $uv)) {
        New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
        # Official uv release, pinned and verified before extraction.
        $archive = Join-Path $toolsDir 'uv.zip'
        $url = 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip'
        Invoke-WebRequest -Uri $url -OutFile $archive
        $expected = 'a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a'
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
            throw 'uv archive checksum mismatch.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir -Force
    }
    & $uv sync --locked
    if ($LASTEXITCODE -ne 0) { throw 'uv sync failed.' }
    if (-not (Test-Path -LiteralPath '.env')) {
        Copy-Item -LiteralPath '.env.example' -Destination '.env'
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js 24+ is required for the React frontend.'
    }
    $nodeMajor = & node -p 'Number(process.versions.node.split(".")[0])'
    if ([int]$nodeMajor -lt 24) { throw 'Install Node.js 24+ before continuing.' }
    & npm.cmd install --no-package-lock
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    & $uv run --locked glpfit doctor
    if ($LASTEXITCODE -ne 0) { throw 'Local environment check failed.' }
}
finally {
    Pop-Location
}

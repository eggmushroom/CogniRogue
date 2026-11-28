# Source checkout bootstrap. Keep downloads inside this checkout, not on the machine PATH.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$toolCache = Join-Path $root '.cache\source-launch\toolchain'
Set-Location -LiteralPath $root

function Get-Sha256($path) {
    $digest = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($path)
    try {
        return [BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $digest.Dispose()
    }
}

function Get-LocalTool($name, $url, $sha256, $subdirectory, $executable, [switch]$TarGz) {
    $ready = Join-Path $toolCache "$name.ready"
    if (Test-Path -LiteralPath $ready -PathType Leaf) {
        $saved = [IO.File]::ReadAllText($ready)
        if ($saved -match ('^' + [regex]::Escape($name) + '-[0-9a-f]{32}$')) {
            $install = Join-Path $toolCache $saved
            $bin = if ($subdirectory) { Join-Path $install $subdirectory } else { $install }
            if (Test-Path -LiteralPath (Join-Path $bin $executable) -PathType Leaf) { return $bin }
        }
    }
    if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
        throw 'Automatic tool installation supports Windows x64. On other architectures, install Node.js 22+ and uv 0.11.7+ and run npm start.'
    }

    New-Item -Path $toolCache -ItemType Directory -Force | Out-Null
    # Extract to a unique final directory. Write the ready marker only after
    # verification, without renaming a tree containing Windows executables.
    $entry = "$name-" + [Guid]::NewGuid().ToString('N')
    $pending = Join-Path $toolCache $entry
    $archive = if ($TarGz) { "$pending.tar.gz" } else { "$pending.zip" }
    $cachePrefix = [IO.Path]::GetFullPath($toolCache).TrimEnd('\') + '\'
    foreach ($path in @($pending, $archive, $ready)) {
        if (-not [IO.Path]::GetFullPath($path).StartsWith($cachePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to stage files outside the source-launch cache.'
        }
    }
    $complete = $false
    try {
        Write-Host "Downloading $name into this checkout (first launch only)..."
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            & $curl.Source --fail --location --retry 2 --connect-timeout 20 --max-time 600 --output $archive $url
            if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
        } else {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
        }
        if ((Get-Sha256 $archive) -ne $sha256) {
            throw "SHA-256 verification failed for $name. Nothing from this archive was run."
        }
        if ($TarGz) {
            New-Item -Path $pending -ItemType Directory | Out-Null
            & tar.exe -xf $archive -C $pending
            if ($LASTEXITCODE -ne 0) { throw "Extraction failed for $name." }
        } else {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Compression.ZipFile]::ExtractToDirectory($archive, $pending)
        }
        $stagedBin = if ($subdirectory) { Join-Path $pending $subdirectory } else { $pending }
        if (-not (Test-Path -LiteralPath (Join-Path $stagedBin $executable) -PathType Leaf)) {
            throw "Missing executable in archive: $executable"
        }
        [IO.File]::WriteAllText($ready, $entry)
        $complete = $true
        return $stagedBin
    } finally {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        if (-not $complete) { Remove-Item -LiteralPath $pending -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

try {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $nodeVersion = if ($node) { & $node.Source --version }
    if (-not $npm -or -not ($nodeVersion -match '^v(\d+)\.') -or [int]$Matches[1] -lt 22) {
        $nodeBin = Get-LocalTool 'node-v24.22.3' `
            'https://nodejs.org/dist/v24.22.3/node-v24.22.3-win-x64.zip' `
            'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f' `
            'node-v24.22.3-win-x64' 'npm.cmd'
        $env:PATH = "$nodeBin;$env:PATH"
        $npm = Get-Command npm.cmd
    }

    $uv = Get-Command uv.exe -ErrorAction SilentlyContinue
    $uvVersion = if ($uv) { & $uv.Source --version }
    if (-not ($uvVersion -match '^uv (\d+\.\d+\.\d+)') -or [version]$Matches[1] -lt [version]'0.11.7') {
        $uvBin = Get-LocalTool 'uv-0.11.7' `
            'https://github.com/astral-sh/uv/releases/download/0.11.7/uv-x86_64-pc-windows-msvc.zip' `
            'fe0c7815acf4fc45f8a5eff58ed3cf7ae2e15c3cf1dceadbd10c816ec1690cc1' `
            '' 'uv.exe'
        $env:PATH = "$uvBin;$env:PATH"
        $uv = Get-Command uv.exe
    }

    $venv = if ($env:UV_PROJECT_ENVIRONMENT) { $env:UV_PROJECT_ENVIRONMENT } else { '.venv' }
    if (-not $env:UV_PYTHON -and -not (Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))) {
        # Reuse a compatible Python without asking uv to download into its
        # user-wide toolchain. The same pinned portable runtime works on a
        # clean Windows machine and stays with this checkout.
        $hasPython = & {
            $ErrorActionPreference = 'SilentlyContinue'
            & $uv.Source python find --no-python-downloads 3.12 2>$null | Out-Null
            $LASTEXITCODE -eq 0
        }
        if (-not $hasPython) {
            $pythonBin = Get-LocalTool 'python-3.12.13' `
                'https://github.com/astral-sh/python-build-standalone/releases/download/20260414/cpython-3.12.13%2B20260414-x86_64-pc-windows-msvc-install_only_stripped.tar.gz' `
                'd785d2e901a8194dcdb8c23c2b37a46ed84fdc04e87398dc5b832644330de71e' `
                'python' 'python.exe' -TarGz
            $env:UV_PYTHON = Join-Path $pythonBin 'python.exe'
        }
    }

    if ($args.Count) {
        & $npm.Source start -- @args
    } else {
        & $npm.Source start
    }
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("CogniRogue startup failed: " + $_.Exception.Message)
    exit 1
}

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$Commit,

    [string]$HostName = "43.138.192.8",
    [string]$User = "ubuntu",
    [string]$DeployPath = "/opt/synapse",
    [string]$KeyPath = "$HOME\.ssh\synapse_deploy_rsa",
    [string]$Repo = "RaykieLee/Synapse"
)

$ErrorActionPreference = "Stop"

if ($DeployPath -notmatch '^/opt/synapse(?:/|$)') {
    throw "DeployPath must be /opt/synapse or one of its subdirectories."
}
if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found: $KeyPath"
}

$artifactName = "synapse-release-$Commit"
$artifactDir = Join-Path $PSScriptRoot "..\.artifacts\$Commit"
$artifactDir = [IO.Path]::GetFullPath($artifactDir)
$releaseDir = "$DeployPath/releases/$Commit"
$sshTarget = "$User@$HostName"
$sshBase = @(
    "-i", $KeyPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=6"
)

if (Test-Path -LiteralPath $artifactDir) {
    Remove-Item -LiteralPath $artifactDir -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

Write-Host "Downloading $artifactName"
& gh run download --repo $Repo --name $artifactName --dir $artifactDir
if ($LASTEXITCODE -ne 0) {
    throw "Could not download Actions artifact $artifactName."
}

$imageBundle = Join-Path $artifactDir "synapse-images.tar.gz"
$checksumFile = "$imageBundle.sha256"
if (-not (Test-Path -LiteralPath $imageBundle) -or -not (Test-Path -LiteralPath $checksumFile)) {
    throw "Artifact is incomplete: $artifactDir"
}

$expectedHash = ((Get-Content -LiteralPath $checksumFile -TotalCount 1) -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $imageBundle -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) {
    throw "Artifact SHA-256 mismatch."
}

Write-Host "Preparing $releaseDir on $sshTarget"
& ssh @sshBase $sshTarget "mkdir -p '$releaseDir'"
if ($LASTEXITCODE -ne 0) {
    throw "Could not create remote release directory."
}

Write-Host "Uploading release artifact"
$remote = "${sshTarget}:$releaseDir/"
& scp @sshBase "$artifactDir/*" $remote
if ($LASTEXITCODE -ne 0) {
    throw "Release upload failed. Re-run the script to retry."
}

$remoteCheck = "cd '$releaseDir' && sha256sum -c synapse-images.tar.gz.sha256"
& ssh @sshBase $sshTarget $remoteCheck
if ($LASTEXITCODE -ne 0) {
    throw "Remote SHA-256 verification failed."
}

Write-Host "Activating $Commit"
$activate = "sudo bash '$releaseDir/deploy-remote.sh' '$releaseDir' '$Commit'"
& ssh @sshBase $sshTarget $activate
if ($LASTEXITCODE -ne 0) {
    throw "Remote activation failed. The deploy script should have attempted rollback."
}

Write-Host "Release $Commit activated successfully."

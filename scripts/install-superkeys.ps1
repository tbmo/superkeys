# PowerShell script to package and install Superkeys extension

# Set variables
$EXTENSION_ID = "matricks.superkeys"

# Function to find VS Code command
function Get-VSCodeCommand {
    # Try common VS Code commands
    $commands = @("code", "code.cmd", "code-insiders", "code-insiders.cmd")
    
    foreach ($cmd in $commands) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) {
            return $cmd
        }
    }
    
    # Check if VS Code is in PATH
    $vscodePath = where.exe code 2>$null
    if ($vscodePath) {
        return "code"
    }
    
    # Check common installation paths
    $commonPaths = @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
        "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd",
        "${env:ProgramFiles(x86)}\Microsoft VS Code\bin\code.cmd"
    )
    
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            return $path
        }
    }
    
    return $null
}

# Function to find the latest VSIX file
function Get-LatestVSIX {
    # Get all VSIX files matching the pattern
    $vsixFiles = Get-ChildItem -Path . -Filter "superkeys-*.vsix" -ErrorAction SilentlyContinue
    
    if ($vsixFiles.Count -eq 0) {
        return $null
    }
    
    # Sort by version number extracted from filename
    $sortedFiles = $vsixFiles | Sort-Object {
        if ($_.Name -match 'superkeys-(\d+)\.(\d+)\.(\d+)\.vsix') {
            [version]"$($matches[1]).$($matches[2]).$($matches[3])"
        } else {
            [version]"0.0.0"
        }
    } -Descending
    
    return $sortedFiles[0].Name
}

# Find VS Code command
$CODE_CMD = Get-VSCodeCommand

if (-not $CODE_CMD) {
    Write-Host "Error: VS Code command not found. Please ensure VS Code is installed and in PATH." -ForegroundColor Red
    exit 1
}

Write-Host "Using VS Code command: $CODE_CMD" -ForegroundColor Green

# Check if vsce is available
if (-not (Get-Command vsce -ErrorAction SilentlyContinue)) {
    Write-Host "Error: vsce not found. Please install it with: npm install -g vsce" -ForegroundColor Red
    exit 1
}

# Clean up old VSIX files
Write-Host "Cleaning up old VSIX files..." -ForegroundColor Yellow
Remove-Item -Path "superkeys-*.vsix" -Force -ErrorAction SilentlyContinue

# Package the extension
Write-Host "Packaging extension with vsce..." -ForegroundColor Yellow
try {
    vsce package
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to package extension" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "Error: Failed to package extension - $_" -ForegroundColor Red
    exit 1
}

# Find the generated VSIX file
$VSIX_PATH = Get-LatestVSIX

if (-not $VSIX_PATH) {
    Write-Host "Error: No VSIX file found after packaging" -ForegroundColor Red
    exit 1
}

Write-Host "Found VSIX file: $VSIX_PATH" -ForegroundColor Green

# Uninstall existing extension if it exists
# Write-Host "Checking for existing Superkeys extension..." -ForegroundColor Yellow
# $installedExtensions = & $CODE_CMD --list-extensions 2>$null

# if ($installedExtensions -contains $EXTENSION_ID) {
#     Write-Host "Uninstalling existing Superkeys extension..." -ForegroundColor Yellow
#     & $CODE_CMD --uninstall-extension $EXTENSION_ID
    
#     # Wait a moment for uninstall to complete
#     Start-Sleep -Seconds 2
# } else {
#     Write-Host "Superkeys extension not found, skipping uninstall." -ForegroundColor Gray
# }

# Install the new version
Write-Host "Installing Superkeys extension from $VSIX_PATH..." -ForegroundColor Yellow
& $CODE_CMD --install-extension $VSIX_PATH


Write-Host "Done." -ForegroundColor Yellow

# Wait a moment for installation to complete
# Start-Sleep -Seconds 2

# # Verify installation
# Write-Host "Verifying installation..." -ForegroundColor Yellow
# $installedExtensions = & $CODE_CMD --list-extensions 2>$null

# if ($installedExtensions -contains $EXTENSION_ID) {
#     Write-Host "Superkeys extension installed successfully!" -ForegroundColor Green
#     Write-Host "Installed version from: $VSIX_PATH" -ForegroundColor Green
# } else {
#     Write-Host "Failed to install Superkeys extension." -ForegroundColor Red
#     exit 1
# }
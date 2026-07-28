#!/bin/bash

# Package and install Superkeys extension

# Package
echo "Packaging extension..."
vsce package

# Find the VSIX file
VSIX=$(ls -t superkeys-*.vsix 2>/dev/null | head -n1)

if [ -z "$VSIX" ]; then
    echo "Error: No VSIX file found"
    exit 1
fi

# Install
echo "Installing $VSIX..."
code --install-extension "$VSIX"

echo "Done"
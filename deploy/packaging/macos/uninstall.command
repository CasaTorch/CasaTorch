#!/bin/sh
# Double-click to remove CasaTorch. Your settings in /Library/Application Support/CasaTorch are kept
# unless you answer "y" below.
echo "Removing CasaTorch (your Mac password is needed)..."
sudo launchctl bootout system/com.casatorch.server 2>/dev/null
sudo rm -rf /Library/CasaTorch /Library/LaunchDaemons/com.casatorch.server.plist /Applications/CasaTorch.webloc
sudo pkgutil --forget com.casatorch.server >/dev/null 2>&1
printf "Also delete your CasaTorch settings? [y/N] "; read a
if [ "$a" = y ]; then
  sudo rm -rf "/Library/Application Support/CasaTorch"
  # the key store's wrapping key and CasaTorch's own account go with the settings
  sudo security delete-generic-password -s com.casatorch.secret-key -a casatorch /Library/Keychains/System.keychain >/dev/null 2>&1
  sudo dscl . -delete /Users/_casatorch >/dev/null 2>&1; sudo dscl . -delete /Groups/_casatorch >/dev/null 2>&1
fi
echo "Done."

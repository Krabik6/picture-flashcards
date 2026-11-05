#!/bin/zsh
# Runs an Obsidian command against the vault used for manual checks and hides the launcher's own noise.
/Applications/Obsidian.app/Contents/MacOS/obsidian vault=lev-main-vault "$@" 2>&1 | grep -v -E "Loading updated app package|installer is out of date"

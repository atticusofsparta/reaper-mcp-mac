#!/usr/bin/env bash
#
# Install the REAPER MCP Lua bridge on macOS.
#
#   - copies lua/mcp_bridge.lua into REAPER's Scripts folder
#   - optionally wires it into REAPER's __startup.lua so it auto-runs on launch
#
# After running, either restart REAPER (if you chose auto-start) or run the
# script once manually: Actions > Show action list > find "reaper_mcp_bridge"
# > Run. The bridge stays alive via a defer loop.

set -euo pipefail

RES_DIR="${REAPER_RESOURCE_PATH:-$HOME/Library/Application Support/REAPER}"
SCRIPTS_DIR="$RES_DIR/Scripts"
SRC="$(cd "$(dirname "$0")/.." && pwd)/lua/mcp_bridge.lua"
DEST="$SCRIPTS_DIR/reaper_mcp_bridge.lua"
STARTUP="$SCRIPTS_DIR/__startup.lua"

if [[ ! -d "$RES_DIR" ]]; then
  echo "ERROR: REAPER resource dir not found at: $RES_DIR" >&2
  echo "Set REAPER_RESOURCE_PATH to override." >&2
  exit 1
fi

mkdir -p "$SCRIPTS_DIR"
cp "$SRC" "$DEST"
echo "Installed bridge -> $DEST"

read -r -p "Auto-start the bridge when REAPER launches? [y/N] " reply
if [[ "$reply" =~ ^[Yy]$ ]]; then
  LOAD_LINE='dofile(reaper.GetResourcePath() .. "/Scripts/reaper_mcp_bridge.lua")'
  if [[ -f "$STARTUP" ]] && grep -qF "reaper_mcp_bridge.lua" "$STARTUP"; then
    echo "__startup.lua already references the bridge; leaving as-is."
  else
    {
      echo ""
      echo "-- reaper-mcp-mac: auto-start MCP bridge"
      echo "$LOAD_LINE"
    } >> "$STARTUP"
    echo "Appended auto-start to $STARTUP"
  fi
  echo "Restart REAPER to activate."
else
  echo "Skipped auto-start. Run 'reaper_mcp_bridge' from the Actions list to start it."
fi

# reaper-mcp-mac

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant drive a **live REAPER session** on macOS — create tracks, write MIDI, add FX, control transport — in real time.

```
Claude (MCP client)  ──stdio──►  reaper-mcp-mac (Node/TS)  ──file IPC──►  Lua bridge inside REAPER
```

Node/TypeScript server + a Lua ReaScript bridge that runs inside REAPER. They talk over **file-based IPC** (JSON request/response files in a shared folder) — no sockets, no extensions, no LuaSocket. Reliable and dependency-free.

## Why this shape

REAPER embeds a native Lua interpreter with the complete ReaScript API, but only *inside* its own process — Node can't call it directly. So the bridge is Lua (mandatory), and the MCP server is Node (talks to Claude). The two halves exchange atomic JSON files: the server writes `request_<id>.json`, the Lua defer loop executes it and writes `response_<id>.json`.

## Requirements

- macOS, REAPER 7.x (developed against 7.79)
- Node.js 18+ (tested on 24)

## Install

```bash
cd reaper-mcp
npm install
npm run build
```

### 1. Install the Lua bridge into REAPER

```bash
./scripts/install_bridge.sh
```

This copies `lua/mcp_bridge.lua` to `~/Library/Application Support/REAPER/Scripts/reaper_mcp_bridge.lua` and offers to auto-start it on REAPER launch.

### 2. Start the bridge inside REAPER

- **If you chose auto-start:** restart REAPER.
- **Otherwise (or right now, without restarting):** in REAPER →
  `Actions` → `Show action list…` → `New action…` → `Load ReaScript…` →
  select `Scripts/reaper_mcp_bridge.lua` → then select it in the list and click **Run**.

A ReaScript console appears showing `[reaper-mcp-mac] bridge started`. The bridge then runs quietly via a `defer` loop until REAPER closes.

### 3. Verify the round-trip

```bash
npm run smoke
```

Expected: a `_ping` with REAPER's version, the project state, and a track count. If it times out, the bridge isn't running inside REAPER (see step 2).

## Use with an MCP client

Point your MCP client at the built server. Example (Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "reaper": {
      "command": "node",
      "args": ["/Users/atticus/Documents/code/atticusofsparta/reaper-mcp/dist/index.js"]
    }
  }
}
```

For Claude Code:

```bash
claude mcp add reaper -- node /Users/atticus/Documents/code/atticusofsparta/reaper-mcp/dist/index.js
```

## Tools

| Tool | Purpose |
|---|---|
| `reaper_ping` | Confirm the bridge is alive; returns REAPER version |
| `reaper_get_project_state` | Tempo, length, play state, track list |
| `reaper_set_tempo` | Set project BPM |
| `reaper_save_project` | Save the project |
| `reaper_insert_track` / `reaper_delete_track` | Add / remove tracks |
| `reaper_set_track_name` / `_mute` / `_solo` / `_volume` | Track properties (volume in dB) |
| `reaper_create_midi_item` | New MIDI item, positioned in beats |
| `reaper_add_midi_notes` | Insert notes (beats, pitch, velocity, channel) |
| `reaper_list_track_fx` / `reaper_add_fx` | FX chain management |
| `reaper_get_fx_params` / `reaper_set_fx_param` | Read/write FX parameters |
| `reaper_transport` | play / stop / pause / record |
| `reaper_set_edit_cursor` | Move edit cursor (seconds) |
| `reaper_render` | Bounce the master to a 24-bit WAV (time selection or whole project) |
| `reaper_call` | **Escape hatch:** call any ReaScript function by name |

### The escape hatch

`reaper_call` exposes the entire ReaScript API generically: `{"func":"CountTracks","args":[0]}`. Pointers returned by the API come back as `"handle:N"` strings (valid within the session) and can be passed back as args to chain calls. Dedicated tools are preferred where they exist, but this means the server is never blocked on a missing wrapper.

## Configuration

- `REAPER_MCP_BRIDGE_DIR` — override the shared IPC folder (must match on both sides).
- `REAPER_MCP_TIMEOUT` — per-call timeout in ms (default 15000; raise for very large MIDI inserts).

## Layout

```
lua/mcp_bridge.lua      # runs inside REAPER: JSON codec, handle registry, dispatch, defer loop
src/bridge.ts           # file-IPC client (serialized calls, atomic writes, stale purge)
src/index.ts            # MCP server entry (stdio)
src/tools/              # tool definitions by domain
src/smoke.ts            # direct bridge round-trip test
scripts/install_bridge.sh
```

## Limitations & notes

- Handles (`handle:N`) are per-session; they reset when REAPER restarts.
- The bridge services requests at REAPER's defer cadence (~30–60/sec), so batch bulk work (insert many notes in one `reaper_add_midi_notes` call) rather than looping single calls.
- File-based IPC only; a socket transport could be added later for lower latency.

## Credit

Architecture (Lua bridge + external server, file IPC, generic dispatch) is informed by the prior Python projects [Aavishkar-Kolte/reaper-daw-mcp-server](https://github.com/Aavishkar-Kolte/reaper-daw-mcp-server) and [shiehn/total-reaper-mcp](https://github.com/shiehn/total-reaper-mcp). This is an independent macOS Node/TypeScript implementation.

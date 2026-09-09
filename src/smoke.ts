/**
 * Standalone smoke test: talks to the Lua bridge directly (no MCP layer) to
 * prove the file-IPC round-trip works against a live REAPER session.
 *
 *   npm run smoke
 *
 * Requires the Lua bridge to be running inside REAPER.
 */
import { ReaperBridge } from "./bridge.js";

async function main(): Promise<void> {
  const bridge = new ReaperBridge({ timeoutMs: 5000 });
  console.log(`bridge dir: ${bridge.dir}`);

  console.log("\n1) ping ...");
  console.log(await bridge.call("_ping"));

  console.log("\n2) project state ...");
  const state = await bridge.call<{ num_tracks: number; bpm: number }>(
    "_get_project_state",
  );
  console.log(JSON.stringify(state, null, 2));

  console.log("\n3) generic call CountTracks(0) ...");
  console.log(await bridge.call("CountTracks", [0]));

  console.log("\nOK — bridge round-trip works.");
}

main().catch((e) => {
  console.error("\nSMOKE FAILED:", (e as Error).message);
  console.error(
    "\nIf this timed out, the Lua bridge is probably not running inside REAPER.\n" +
      "Run scripts/install_bridge.sh, then in REAPER: Actions > run 'reaper_mcp_bridge'.",
  );
  process.exit(1);
});

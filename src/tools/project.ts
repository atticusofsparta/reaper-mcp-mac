import { z } from "zod";
import { ok, guard, type ToolContext } from "./util.js";

export function registerProjectTools({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_ping",
    {
      title: "Ping REAPER",
      description:
        "Check that the REAPER bridge is alive. Returns the REAPER version. Call this first to confirm the connection.",
      inputSchema: {},
    },
    () => guard(async () => ok(await bridge.call("_ping"))),
  );

  server.registerTool(
    "reaper_get_project_state",
    {
      title: "Get project state",
      description:
        "Return the current project's tempo (BPM), length in seconds, transport play state, and the list of tracks (index, name, item count, mute/solo, volume in dB). Use this to orient before making changes.",
      inputSchema: {},
    },
    () => guard(async () => ok(await bridge.call("_get_project_state"))),
  );

  server.registerTool(
    "reaper_set_tempo",
    {
      title: "Set project tempo",
      description: "Set the project master tempo in BPM.",
      inputSchema: { bpm: z.number().positive().describe("Beats per minute") },
    },
    ({ bpm }) => guard(async () => ok(await bridge.call("_set_tempo", [bpm]))),
  );

  server.registerTool(
    "reaper_save_project",
    {
      title: "Save project",
      description: "Save the current REAPER project to disk.",
      inputSchema: {},
    },
    () => guard(async () => ok(await bridge.call("_save_project"))),
  );
}

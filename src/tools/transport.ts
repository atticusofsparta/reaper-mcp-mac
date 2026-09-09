import { z } from "zod";
import { ok, guard, type ToolContext } from "./util.js";

export function registerTransportTools({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_transport",
    {
      title: "Transport control",
      description:
        "Control playback: play, stop, pause, or record. Returns the resulting play state (0=stopped, 1=playing, 2=paused, 4=recording as bit flags).",
      inputSchema: {
        action: z.enum(["play", "stop", "pause", "record"]),
      },
    },
    ({ action }) => guard(async () => ok(await bridge.call("_transport", [action]))),
  );

  server.registerTool(
    "reaper_set_edit_cursor",
    {
      title: "Move edit cursor",
      description: "Move the edit cursor to a time position in seconds.",
      inputSchema: { seconds: z.number().min(0) },
    },
    ({ seconds }) =>
      guard(async () => ok(await bridge.call("_set_edit_cursor", [seconds]))),
  );
}

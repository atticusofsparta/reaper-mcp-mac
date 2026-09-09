import { z } from "zod";
import { ok, guard, type ToolContext } from "./util.js";

export function registerRawTool({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_call",
    {
      title: "Raw ReaScript call (advanced)",
      description:
        "Escape hatch: call ANY ReaScript API function by name with positional args, for operations the dedicated tools don't cover. " +
        "Example: {\"func\":\"CountTracks\",\"args\":[0]}. " +
        "Pointers returned by the API come back as \"handle:N\" strings, valid only within this REAPER session; pass them back verbatim as args to chain calls. " +
        "Prefer the dedicated reaper_* tools when one exists.",
      inputSchema: {
        func: z.string().describe("ReaScript function name, e.g. 'CountTracks'"),
        args: z
          .array(z.any())
          .default([])
          .describe("Positional arguments; use \"handle:N\" strings for pointers"),
      },
    },
    ({ func, args }) => guard(async () => ok(await bridge.call(func, args))),
  );
}

import { z } from "zod";
import { ok, guard, type ToolContext } from "./util.js";

export function registerTrackTools({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_insert_track",
    {
      title: "Insert track",
      description:
        "Insert a new track at the given index (0-based). Omit index to append at the end. Returns the new track's index.",
      inputSchema: {
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("0-based position; omit to append"),
        name: z.string().optional().describe("Track name"),
      },
    },
    ({ index, name }) =>
      guard(async () => ok(await bridge.call("_insert_track", [index ?? null, name ?? ""]))),
  );

  server.registerTool(
    "reaper_delete_track",
    {
      title: "Delete track",
      description: "Delete the track at the given 0-based index.",
      inputSchema: { index: z.number().int().min(0) },
    },
    ({ index }) => guard(async () => ok(await bridge.call("_delete_track", [index]))),
  );

  server.registerTool(
    "reaper_set_track_name",
    {
      title: "Rename track",
      description: "Set the name of the track at the given index.",
      inputSchema: { index: z.number().int().min(0), name: z.string() },
    },
    ({ index, name }) =>
      guard(async () => ok(await bridge.call("_set_track_name", [index, name]))),
  );

  server.registerTool(
    "reaper_set_track_mute",
    {
      title: "Mute/unmute track",
      description: "Set the mute state of a track.",
      inputSchema: { index: z.number().int().min(0), muted: z.boolean() },
    },
    ({ index, muted }) =>
      guard(async () => ok(await bridge.call("_set_track_mute", [index, muted]))),
  );

  server.registerTool(
    "reaper_set_track_solo",
    {
      title: "Solo/unsolo track",
      description: "Set the solo state of a track.",
      inputSchema: { index: z.number().int().min(0), soloed: z.boolean() },
    },
    ({ index, soloed }) =>
      guard(async () => ok(await bridge.call("_set_track_solo", [index, soloed]))),
  );

  server.registerTool(
    "reaper_set_track_volume",
    {
      title: "Set track volume",
      description: "Set a track's volume in decibels (0 dB = unity, negative = quieter).",
      inputSchema: { index: z.number().int().min(0), db: z.number() },
    },
    ({ index, db }) =>
      guard(async () => ok(await bridge.call("_set_track_volume_db", [index, db]))),
  );
}

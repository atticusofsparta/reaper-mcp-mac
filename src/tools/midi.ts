import { z } from "zod";
import { ok, guard, type ToolContext } from "./util.js";

const noteSchema = z.object({
  start_beat: z.number().min(0).describe("Start position in beats (quarter notes) from item start"),
  length_beat: z.number().positive().describe("Length in beats"),
  pitch: z.number().int().min(0).max(127).describe("MIDI pitch (60 = middle C)"),
  velocity: z.number().int().min(1).max(127).default(96).describe("Note velocity 1-127"),
  channel: z.number().int().min(0).max(15).default(0).describe("MIDI channel 0-15"),
});

export function registerMidiTools({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_create_midi_item",
    {
      title: "Create MIDI item",
      description:
        "Create an empty MIDI item on a track, positioned and sized in beats (quarter notes). Returns the item's index on that track, which you pass to reaper_add_midi_notes.",
      inputSchema: {
        track_index: z.number().int().min(0),
        start_beat: z.number().min(0).default(0).describe("Start position in beats"),
        length_beat: z.number().positive().default(4).describe("Length in beats"),
      },
    },
    ({ track_index, start_beat, length_beat }) =>
      guard(async () =>
        ok(await bridge.call("_create_midi_item", [track_index, start_beat, length_beat])),
      ),
  );

  server.registerTool(
    "reaper_add_midi_notes",
    {
      title: "Add MIDI notes",
      description:
        "Add MIDI notes to the active take of an existing MIDI item. Positions and lengths are in beats relative to the item start. Insert many notes in one call for chords/melodies.",
      inputSchema: {
        track_index: z.number().int().min(0),
        item_index: z.number().int().min(0),
        notes: z.array(noteSchema).min(1).describe("Notes to insert"),
      },
    },
    ({ track_index, item_index, notes }) =>
      guard(async () =>
        ok(await bridge.call("_add_midi_notes", [track_index, item_index, notes])),
      ),
  );
}

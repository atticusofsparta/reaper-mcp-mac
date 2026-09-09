import { z } from "zod";
import { ok, guard, type ToolContext } from "./util.js";

export function registerFxTools({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_list_track_fx",
    {
      title: "List track FX",
      description: "List the FX on a track (index, name, enabled state).",
      inputSchema: { track_index: z.number().int().min(0) },
    },
    ({ track_index }) =>
      guard(async () => ok(await bridge.call("_list_track_fx", [track_index]))),
  );

  server.registerTool(
    "reaper_add_fx",
    {
      title: "Add FX to track",
      description:
        "Add an FX/plugin to a track by name (e.g. 'ReaEQ', 'ReaComp', or a VST name). Returns the new FX index. Matching is fuzzy on the plugin name.",
      inputSchema: {
        track_index: z.number().int().min(0),
        fx_name: z.string().describe("Plugin name, e.g. 'ReaEQ'"),
      },
    },
    ({ track_index, fx_name }) =>
      guard(async () => ok(await bridge.call("_add_fx", [track_index, fx_name]))),
  );

  server.registerTool(
    "reaper_get_fx_params",
    {
      title: "Get FX parameters",
      description:
        "List all parameters of an FX on a track (index, name, current value, min, max). Values are normalized as the plugin reports them.",
      inputSchema: {
        track_index: z.number().int().min(0),
        fx_index: z.number().int().min(0),
      },
    },
    ({ track_index, fx_index }) =>
      guard(async () => ok(await bridge.call("_get_fx_params", [track_index, fx_index]))),
  );

  server.registerTool(
    "reaper_set_fx_param",
    {
      title: "Set FX parameter",
      description: "Set one parameter of an FX by parameter index. Use reaper_get_fx_params to discover indices and ranges.",
      inputSchema: {
        track_index: z.number().int().min(0),
        fx_index: z.number().int().min(0),
        param_index: z.number().int().min(0),
        value: z.number().describe("New parameter value (within the param's min..max)"),
      },
    },
    ({ track_index, fx_index, param_index, value }) =>
      guard(async () =>
        ok(await bridge.call("_set_fx_param", [track_index, fx_index, param_index, value])),
      ),
  );
}

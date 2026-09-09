import { z } from "zod";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, basename, join, extname } from "node:path";
import { ok, guard, type ToolContext } from "./util.js";

// REAPER RENDER_FORMAT config blob for 24-bit WAV (fourcc "evaw"). Setting this
// guarantees WAV output regardless of the user's current render preference.
const WAV_FORMAT_24 = "ZXZhdxgAAQ==";

const BOUNDS = {
  time_selection: 2, // the loop / time selection
  project: 1, // entire project
} as const;

export function registerRenderTool({ server, bridge }: ToolContext): void {
  server.registerTool(
    "reaper_render",
    {
      title: "Render to WAV",
      description:
        "Render (bounce) the project master to a 24-bit WAV file on disk. " +
        "By default renders the current time selection (your loop); set bounds='project' for the whole project. " +
        "Returns the absolute file path and size. Renders headlessly — no dialog.",
      inputSchema: {
        output_path: z
          .string()
          .optional()
          .describe(
            "Absolute path for the .wav (e.g. /Users/me/mix.wav). Omit to auto-name into ~/reaper-mcp-renders/.",
          ),
        bounds: z
          .enum(["time_selection", "project"])
          .default("time_selection")
          .describe("What to render: the time selection/loop, or the entire project"),
      },
    },
    ({ output_path, bounds }) =>
      guard(async () => {
        // resolve output path
        let out = output_path;
        if (!out) {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          out = join(homedir(), "reaper-mcp-renders", `render-${stamp}.wav`);
        }
        const dir = dirname(out);
        // REAPER appends the extension from the render format, so the pattern
        // must NOT carry one.
        const pattern = basename(out).replace(/\.[^.]+$/, "");
        const finalPath = join(dir, `${pattern}.wav`);

        // Node and REAPER share the filesystem (same machine), so we create the
        // dir here and can stat the result afterwards.
        await fs.mkdir(dir, { recursive: true });

        // configure and fire the render
        await bridge.call("GetSetProjectInfo_String", [0, "RENDER_FORMAT", WAV_FORMAT_24, true]);
        await bridge.call("GetSetProjectInfo_String", [0, "RENDER_FILE", dir, true]);
        await bridge.call("GetSetProjectInfo_String", [0, "RENDER_PATTERN", pattern, true]);
        await bridge.call("GetSetProjectInfo", [0, "RENDER_SETTINGS", 0, true]); // master mix
        await bridge.call("GetSetProjectInfo", [0, "RENDER_BOUNDS", BOUNDS[bounds], true]);
        await bridge.call("Main_OnCommand", [42230, 0]); // render using most recent settings (no dialog)

        // verify
        try {
          const st = await fs.stat(finalPath);
          return ok({
            file: finalPath,
            bytes: st.size,
            bounds,
            format: "WAV 24-bit",
          });
        } catch {
          throw new Error(
            `render completed but no file at ${finalPath}. ` +
              (bounds === "time_selection"
                ? "Is there a time selection? Try bounds='project'."
                : "Check REAPER's render settings."),
          );
        }
      }),
  );
}

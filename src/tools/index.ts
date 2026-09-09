import type { ToolContext } from "./util.js";
import { registerProjectTools } from "./project.js";
import { registerTrackTools } from "./tracks.js";
import { registerMidiTools } from "./midi.js";
import { registerFxTools } from "./fx.js";
import { registerTransportTools } from "./transport.js";
import { registerRenderTool } from "./render.js";
import { registerRawTool } from "./raw.js";

export function registerAllTools(ctx: ToolContext): void {
  registerProjectTools(ctx);
  registerTrackTools(ctx);
  registerMidiTools(ctx);
  registerFxTools(ctx);
  registerTransportTools(ctx);
  registerRenderTool(ctx);
  registerRawTool(ctx);
}

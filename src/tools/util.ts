import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReaperBridge } from "../bridge.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wrap any JSON-serializable value as an MCP text result. */
export function ok(value: unknown): ToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Run a handler, turning thrown bridge errors into a clean MCP error result. */
export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    return {
      content: [{ type: "text", text: `REAPER error: ${(e as Error).message}` }],
      isError: true,
    };
  }
}

export interface ToolContext {
  server: McpServer;
  bridge: ReaperBridge;
}

#!/usr/bin/env node
/**
 * reaper-mcp-mac — MCP server that drives a live REAPER session on macOS.
 *
 * Architecture:
 *   MCP client (Claude) <-stdio-> this server <-file IPC-> Lua bridge inside REAPER
 *
 * The Lua bridge (lua/mcp_bridge.lua) must be running inside REAPER. See README.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ReaperBridge } from "./bridge.js";
import { registerAllTools } from "./tools/index.js";

async function main(): Promise<void> {
  const bridge = new ReaperBridge();
  const server = new McpServer({
    name: "reaper-mcp-mac",
    version: "0.1.0",
  });

  registerAllTools({ server, bridge });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP stream.
  process.stderr.write(
    `[reaper-mcp-mac] server ready. bridge dir: ${bridge.dir}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[reaper-mcp-mac] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});

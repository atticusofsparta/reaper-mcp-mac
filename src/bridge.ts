/**
 * File-based IPC client for the REAPER Lua bridge.
 *
 * We write request_<id>.json into the shared bridge directory and poll for the
 * matching response_<id>.json that the Lua defer loop writes back. Calls are
 * serialized through a small promise queue: the bridge only services requests
 * ~30-60x/sec (REAPER's defer cadence), so there is nothing to gain from
 * hammering it concurrently, and serializing keeps ids and cleanup simple.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LuaResponse<T = unknown> {
  ok: boolean;
  ret?: T;
  error?: string;
}

const DEFAULT_BRIDGE_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "REAPER",
  "Scripts",
  "reaper_mcp_bridge_data",
);

export class ReaperBridge {
  readonly dir: string;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private id = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;

  constructor(opts: { dir?: string; timeoutMs?: number; pollMs?: number } = {}) {
    this.dir = opts.dir ?? process.env.REAPER_MCP_BRIDGE_DIR ?? DEFAULT_BRIDGE_DIR;
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.REAPER_MCP_TIMEOUT ?? 15000);
    this.pollMs = opts.pollMs ?? 15;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    // Purge leftovers from a previous run so a stale response can't be misread
    // as the answer to a freshly reused id.
    try {
      const files = await fs.readdir(this.dir);
      await Promise.all(
        files
          .filter((f) => /^(request|response)_\d+\.json$/.test(f))
          .map((f) => fs.rm(join(this.dir, f), { force: true })),
      );
    } catch {
      /* best effort */
    }
  }

  /** Call a bridge function (composite "_name" or a raw ReaScript function). */
  async call<T = unknown>(func: string, args: unknown[] = []): Promise<T> {
    // chain onto the queue so calls run one at a time, in order
    const run = this.queue.then(() => this.doCall<T>(func, args));
    // keep the queue alive even if this call rejects
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doCall<T>(func: string, args: unknown[]): Promise<T> {
    await this.ready;
    const id = ++this.id;
    const reqPath = join(this.dir, `request_${id}.json`);
    const respPath = join(this.dir, `response_${id}.json`);

    // clean slate for this id
    await fs.rm(reqPath, { force: true }).catch(() => {});
    await fs.rm(respPath, { force: true }).catch(() => {});

    // atomic write: tmp then rename so Lua never reads a partial file
    const payload = JSON.stringify({ id, func, args });
    const tmp = `${reqPath}.tmp`;
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, reqPath);

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      let raw: string | undefined;
      try {
        raw = await fs.readFile(respPath, "utf8");
      } catch {
        raw = undefined; // not there yet
      }
      if (raw !== undefined) {
        await fs.rm(respPath, { force: true }).catch(() => {});
        await fs.rm(reqPath, { force: true }).catch(() => {});
        let parsed: LuaResponse<T>;
        try {
          parsed = JSON.parse(raw) as LuaResponse<T>;
        } catch (e) {
          throw new Error(`bridge returned invalid JSON for ${func}: ${(e as Error).message}`);
        }
        if (!parsed.ok) {
          throw new Error(parsed.error ?? `bridge call ${func} failed`);
        }
        return parsed.ret as T;
      }
      await delay(this.pollMs);
    }

    await fs.rm(reqPath, { force: true }).catch(() => {});
    throw new Error(
      `timeout after ${this.timeoutMs}ms waiting for REAPER bridge (func: ${func}). ` +
        `Is the Lua bridge running inside REAPER? (bridge dir: ${this.dir})`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

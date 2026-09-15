import net from "node:net";
import type { ExportedLayout, MoveOutcome, SessionSnapshot } from "../types.js";

interface Envelope<T> {
  id: string;
  result?: T;
  error?: { code: string; message: string };
}

export class HerdrError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

export class HerdrClient {
  private sequence = 0;

  constructor(
    private readonly socketPath = process.env.HERDR_SOCKET_PATH,
    private readonly timeoutMs = 5_000,
  ) {
    if (!socketPath) throw new Error("HERDR_SOCKET_PATH is not set");
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `schlepr-${process.pid}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath!);
      let buffer = "";
      let settled = false;
      const finish = (error?: Error, value?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };
      const timer = setTimeout(
        () => finish(new HerdrError("timeout", `${method} timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ id, method, params })}\n`);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        try {
          const envelope = JSON.parse(buffer.slice(0, newline)) as Envelope<T>;
          if (envelope.id !== id) return;
          if (envelope.error) finish(new HerdrError(envelope.error.code, envelope.error.message));
          else if (envelope.result === undefined) finish(new Error(`${method} returned no result`));
          else finish(undefined, envelope.result);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.on("error", (error) => finish(error));
      socket.on("end", () => {
        if (!settled) finish(new Error(`${method} socket closed before a response`));
      });
    });
  }

  async snapshot(): Promise<SessionSnapshot> {
    const result = await this.request<{ type: string; snapshot: SessionSnapshot }>("session.snapshot");
    return result.snapshot;
  }

  async exportLayout(tabId: string): Promise<ExportedLayout> {
    const result = await this.request<{ type: string; layout: ExportedLayout }>("layout.export", {
      tab_id: tabId,
    });
    return result.layout;
  }

  async movePane(
    paneId: string,
    destination: Record<string, unknown>,
    focus: boolean,
  ): Promise<MoveOutcome> {
    const result = await this.request<{
      type: string;
      move_result: MoveOutcome & { changed: boolean; reason?: string };
    }>("pane.move", { pane_id: paneId, destination, focus });
    const move = result.move_result;
    if (!move.changed) {
      throw new HerdrError("pane_move_refused", `Herdr refused the move${move.reason ? `: ${move.reason}` : ""}`);
    }
    return move;
  }

  async focus(workspaceId: string, tabId: string): Promise<void> {
    await this.request("workspace.focus", { workspace_id: workspaceId });
    await this.request("tab.focus", { tab_id: tabId });
  }
}

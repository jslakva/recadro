/**
 * The notes channel `dev --live` adds to the server: a person at the lineup
 * pins a note to a spot, `recadro wait` prints it, `recadro reply` marks it
 * done. The server carries the words and never reads them. Nothing here runs
 * unless `--live` was asked for; plain `dev` serves none of these paths.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";

/** The header the agent's commands send. A page cannot add it cross-origin without a preflight nobody answers. */
export const AGENT_HEADER = "x-recadro";

/** Where the channel's paths live under the server. */
const BASE = "/__recadro/notes";

/** The most a note request may carry. */
const MAX_BODY = 64 * 1024;

/** How often the lineup's event stream is touched so no idle proxy closes it. */
const PING_MS = 30_000;

/** What `dev --live` leaves for `wait` and `reply` to find the server by. */
export interface LiveFile {
  /** The server's origin, e.g. `http://localhost:5173`. */
  origin: string;
  /** Absolute path of the set it serves. */
  set: string;
}

/**
 * The file `dev --live` writes, in the OS temp dir under a hash of the set's
 * path: nothing in the repository, so no consumer needs a gitignore line, and
 * a `wait` run from anywhere in the repository finds the server for its set.
 * Only `dev --live` writes it; `render` starts its own server and must never
 * be the one found.
 */
export function liveFile(setDir: string): string {
  return join(tmpdir(), "recadro", `${createHash("sha1").update(setDir).digest("hex").slice(0, 16)}.json`);
}

/** Writes the live file, and removes it when the process ends however it ends. */
export function announceLive(setDir: string, origin: string): void {
  const file = liveFile(setDir);
  mkdirSync(join(tmpdir(), "recadro"), { recursive: true });
  writeFileSync(file, JSON.stringify({ origin, set: setDir } satisfies LiveFile));
  const remove = () => rmSync(file, { force: true });
  process.on("exit", remove);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      remove();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

/** Reads the live file for a set, or null when no `dev --live` announced one. */
export function readLive(setDir: string): LiveFile | null {
  try {
    return JSON.parse(readFileSync(liveFile(setDir), "utf8")) as LiveFile;
  } catch {
    return null;
  }
}

/** A note as the lineup sent it, plus what the channel adds. */
export interface Note {
  /** Counted from 1 while the server runs. */
  id: number;
  /** The reference the lineup's pointer built: slug, slot, locale, file, point, element. */
  reference: string;
  /** The person's words. */
  note: string;
  /** The panel, so the lineup can draw the pin on the right frame after a reload. */
  slug: string;
  /** The spot as fractions of the panel's width and height, for the pin. */
  spot: { x: number; y: number } | null;
  /** Whether a `wait` has printed it, so the lineup can show it as with the agent. */
  delivered: boolean;
  /** The agent's one line, once it replied. */
  reply: string | null;
}

/** Body of a `POST /__recadro/notes`; what the lineup sends. */
interface NoteRequest {
  reference?: unknown;
  note?: unknown;
  slug?: unknown;
  spot?: unknown;
}

/** Reads a request body as JSON, refusing one over `MAX_BODY`. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

/** Sends JSON with a status. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/**
 * Whether a request came from a page on this server. Browsers send `Origin`
 * on every cross-origin POST and on same-origin ones too, so the lineup's own
 * requests carry the server's origin and a hostile page's carry its own; the
 * scheme and host the request arrived on are what the origin must match.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const scheme = (req.socket as TLSSocket).encrypted ? "https" : "http";
  return req.headers.origin === `${scheme}://${req.headers.host}`;
}

/**
 * The channel's state: every note since the server started, the `wait`
 * connections that print new ones, and the lineup connections told about them.
 */
export class NoteChannel {
  private notes: Note[] = [];
  private nextId = 1;
  /** When this server started, so a lineup can keep what it dismissed across a reload without carrying it into the next run, whose ids start over. */
  private readonly started = Date.now();
  /** Notes no `wait` has printed yet; delivered to the first one that connects. */
  private undelivered: Note[] = [];
  private waiters = new Set<ServerResponse>();
  private lineups = new Set<ServerResponse>();

  /** Handles a request under the channel's paths; false when the path is not the channel's. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? "").split("?")[0];
    if (path === BASE && req.method === "POST") {
      void this.post(req, res);
      return true;
    }
    if (path === `${BASE}/events` && req.method === "GET") {
      this.events(res);
      return true;
    }
    if (path === `${BASE}/wait` && req.method === "GET") {
      if (!req.headers[AGENT_HEADER]) {
        sendJson(res, 403, { error: `${AGENT_HEADER} header required` });
        return true;
      }
      this.wait(res);
      return true;
    }
    const reply = path.match(new RegExp(`^${BASE}/(\\d+)/reply$`));
    if (reply && req.method === "POST") {
      if (!req.headers[AGENT_HEADER]) {
        sendJson(res, 403, { error: `${AGENT_HEADER} header required` });
        return true;
      }
      void this.reply(Number(reply[1]), req, res);
      return true;
    }
    return false;
  }

  /** Whether any `wait` is connected right now. */
  get listening(): boolean {
    return this.waiters.size > 0;
  }

  /** A note from the lineup: kept, handed to a waiting agent, shown as a pin. */
  private async post(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: "notes are taken from the lineup on this server only" });
      return;
    }
    let body: NoteRequest;
    try {
      body = ((await readJson(req)) ?? {}) as NoteRequest;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "bad request" });
      return;
    }
    const text = typeof body.note === "string" ? body.note.trim() : "";
    if (!text) {
      sendJson(res, 400, { error: "a note needs words" });
      return;
    }
    const spot = body.spot as { x?: unknown; y?: unknown } | undefined;
    const note: Note = {
      id: this.nextId++,
      reference: typeof body.reference === "string" ? body.reference : "",
      note: text,
      slug: typeof body.slug === "string" ? body.slug : "",
      spot: typeof spot?.x === "number" && typeof spot?.y === "number" ? { x: spot.x, y: spot.y } : null,
      delivered: false,
      reply: null,
    };
    this.notes.push(note);
    this.deliver(note);
    this.tellLineups("note", note);
    sendJson(res, 201, { id: note.id });
  }

  /** Prints a note on every waiting connection, or keeps it for the first one to come. */
  private deliver(note: Note): void {
    if (!this.waiters.size) {
      this.undelivered.push(note);
      return;
    }
    note.delivered = true;
    const line = `${JSON.stringify(note)}\n`;
    for (const waiter of this.waiters) waiter.write(line);
  }

  /**
   * A `wait` connection: one JSON line per note, the ones nobody printed yet
   * first, then each new one as it comes, until the server or the client goes.
   */
  private wait(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    this.waiters.add(res);
    for (const note of this.undelivered.splice(0)) {
      note.delivered = true;
      res.write(`${JSON.stringify(note)}\n`);
      this.tellLineups("note", note);
    }
    this.tellLineups("listening", { listening: true });
    res.on("close", () => {
      this.waiters.delete(res);
      this.tellLineups("listening", { listening: this.listening });
    });
  }

  /** The agent's one line about a note, shown in the lineup at its pin. */
  private async reply(id: number, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const note = this.notes.find((n) => n.id === id);
    if (!note) {
      sendJson(res, 404, { error: `no note ${id}` });
      return;
    }
    let body: { text?: unknown };
    try {
      body = ((await readJson(req)) ?? {}) as { text?: unknown };
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "bad request" });
      return;
    }
    note.reply = typeof body.text === "string" && body.text.trim() ? body.text.trim() : "done";
    this.tellLineups("note", note);
    sendJson(res, 200, { id: note.id, slug: note.slug });
  }

  /**
   * The lineup's event stream: whether anyone is listening and every note's
   * state, the whole of it first so a reloaded lineup draws its pins again.
   */
  private events(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify({ started: this.started, listening: this.listening, notes: this.notes })}\n\n`);
    this.lineups.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    res.on("close", () => {
      clearInterval(ping);
      this.lineups.delete(res);
    });
  }

  /** Sends one event to every open lineup. */
  private tellLineups(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const lineup of this.lineups) lineup.write(message);
  }
}

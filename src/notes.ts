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

/** How long a one-shot `wait` stays open after a note, for the next one to join it. */
const BURST_MS = 200;

/** How long after a `wait` ends the agent still counts as working, for the next `wait` to connect. */
const BETWEEN_WAITS_MS = 60_000;

/** How long a printed note may go without a reply before the next `wait` prints it again. */
export const REDELIVER_MS = 600_000;

/** The longest a one-shot `wait` may be asked to wait, in seconds. */
export const MAX_TIMEOUT_S = 24 * 60 * 60;

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
  /** How many times it went back to waiting because no reply came, so `wait` can say it prints it again. */
  repeat: number;
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
 * Whether an agent is there, as the lineup shows it: `listening` while a
 * `wait` is connected; `working` between two of them, while a printed note has
 * no reply or the last `wait` ended moments ago; `none` otherwise. The lineup
 * takes notes in the first two and copies in the last.
 */
export interface AgentState {
  state: "listening" | "working" | "none";
  /** The notes printed and not answered, while working. */
  on: number[];
}

/** A connected `wait`. A one-shot one ends after its notes, or at its timeout. */
interface Waiter {
  res: ServerResponse;
  once: boolean;
  /** Set once it printed a note: ends it when no other note came within `BURST_MS`. */
  burst?: NodeJS.Timeout;
  /** Ends a one-shot `wait` that got no note in the time it asked for. */
  timeout?: NodeJS.Timeout;
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
  private waiters = new Set<Waiter>();
  private lineups = new Set<ServerResponse>();
  /** When the last `wait` went away, for the working state between two of them. */
  private lastWaitEnded = 0;
  /** Ends the working state the last `wait` left behind. */
  private betweenWaits?: NodeJS.Timeout;
  /** Puts a printed note back to waiting when no reply came, by id. */
  private redeliver = new Map<number, NodeJS.Timeout>();
  /** The agent state last sent to the lineups, so they hear only a change. */
  private told = "";

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
      const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const once = query.get("once") === "1";
      const timeout = Number(query.get("timeout") ?? "");
      if (once && query.has("timeout") && !(Number.isInteger(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT_S)) {
        sendJson(res, 400, { error: `timeout is whole seconds from 1 to ${MAX_TIMEOUT_S}` });
        return true;
      }
      this.wait(res, once, once && query.has("timeout") ? timeout : null);
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

  /** Whether an agent is there, and on which notes; see `AgentState`. */
  get agent(): AgentState {
    if (this.waiters.size) return { state: "listening", on: [] };
    const on = this.notes.filter((n) => n.delivered && !n.reply).map((n) => n.id);
    const recent = this.lastWaitEnded > 0 && Date.now() - this.lastWaitEnded < BETWEEN_WAITS_MS;
    return { state: on.length || recent ? "working" : "none", on };
  }

  /** Tells the lineups the agent state, when it changed since they last heard. */
  private tellAgent(): void {
    const agent = this.agent;
    const said = JSON.stringify(agent);
    if (said === this.told) return;
    this.told = said;
    this.tellLineups("agent", agent);
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
      repeat: 0,
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
      this.tellAgent();
      return;
    }
    for (const waiter of this.waiters) this.print(waiter, note);
    this.delivered(note);
  }

  /** Writes a note to one `wait`; a one-shot one then ends unless another follows within `BURST_MS`. */
  private print(waiter: Waiter, note: Note): void {
    waiter.res.write(`${JSON.stringify(note)}\n`);
    if (!waiter.once) return;
    clearTimeout(waiter.timeout);
    clearTimeout(waiter.burst);
    waiter.burst = setTimeout(() => waiter.res.end(), BURST_MS);
  }

  /**
   * Marks a note printed, and arms its redelivery: with no reply in
   * `REDELIVER_MS` it goes back to waiting, and the next `wait` — or the one
   * connected — prints it again, marked as a repeat. An agent that lost its
   * turn, or its note, between `wait` and `reply` gets it back.
   */
  private delivered(note: Note): void {
    note.delivered = true;
    this.tellLineups("note", note);
    clearTimeout(this.redeliver.get(note.id));
    const timer = setTimeout(() => {
      this.redeliver.delete(note.id);
      if (note.reply) return;
      note.delivered = false;
      note.repeat += 1;
      this.tellLineups("note", note);
      this.deliver(note);
    }, REDELIVER_MS);
    timer.unref();
    this.redeliver.set(note.id, timer);
  }

  /**
   * A `wait` connection: one JSON line per note, the ones nobody printed yet
   * first, then each new one as it comes. A stream runs until the server or the
   * client goes; a one-shot one (`once`) ends `BURST_MS` after its last note,
   * or with a `{"timeout":…}` line when none came in `timeout` seconds.
   */
  private wait(res: ServerResponse, once: boolean, timeout: number | null): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const waiter: Waiter = { res, once };
    this.waiters.add(waiter);
    clearTimeout(this.betweenWaits);
    for (const note of this.undelivered.splice(0)) {
      this.print(waiter, note);
      this.delivered(note);
    }
    if (once && timeout !== null && !waiter.burst) {
      waiter.timeout = setTimeout(() => res.end(`${JSON.stringify({ timeout })}\n`), timeout * 1000);
    }
    this.tellAgent();
    res.on("close", () => {
      clearTimeout(waiter.burst);
      clearTimeout(waiter.timeout);
      this.waiters.delete(waiter);
      if (!this.waiters.size) {
        this.lastWaitEnded = Date.now();
        clearTimeout(this.betweenWaits);
        this.betweenWaits = setTimeout(() => this.tellAgent(), BETWEEN_WAITS_MS + 50);
        this.betweenWaits.unref();
      }
      this.tellAgent();
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
    clearTimeout(this.redeliver.get(id));
    this.redeliver.delete(id);
    // Answered while waiting to be printed again: nobody needs it now.
    this.undelivered = this.undelivered.filter((n) => n !== note);
    this.tellLineups("note", note);
    this.tellAgent();
    sendJson(res, 200, { id: note.id, slug: note.slug });
  }

  /**
   * The lineup's event stream: whether an agent is there and every note's
   * state, the whole of it first so a reloaded lineup draws its pins again.
   */
  private events(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify({ started: this.started, agent: this.agent, notes: this.notes })}\n\n`);
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

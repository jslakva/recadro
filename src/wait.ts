/**
 * `wait` and `reply`: the agent's side of the notes channel. `wait` connects to
 * the server `dev --live` announced for the set and prints each note as it
 * arrives, in the CLI's voice, for as long as that server lives; `reply` posts
 * one line back and exits. Neither reads the set; both only find it.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { AGENT_HEADER, readLive, type LiveFile, type Note } from "./notes.ts";

/** The column the CLI's detail lines start in. */
const PAD = "         ";

/** The request function for a URL's scheme. */
const requestFor = (url: URL) => (url.protocol === "https:" ? httpsRequest : httpRequest);

/** The live server for a set, or the error that says how to start one. */
function liveFor(setDir: string, shown: string): LiveFile {
  const live = readLive(setDir);
  if (!live) throw new Error(`no recadro dev --live is running for ${shown}; start one with: recadro dev --live --panels ${shown}`);
  return live;
}

/** The same error once a connection told us the announced server is not there. */
function gone(live: LiveFile, shown: string): Error {
  return new Error(`no recadro dev --live answers at ${live.origin} for ${shown}; start one with: recadro dev --live --panels ${shown}`);
}

/**
 * A note as `wait` prints it: the reference the lineup built, the person's
 * words marked as theirs, and the command that answers. The words are printed
 * as given; nothing here rephrases or adds to them.
 */
export function formatNote(note: Note): string {
  const lines = [`recadro  note ${note.id} from the person at the lineup`];
  for (const line of note.reference.split("\n").filter(Boolean)) lines.push(PAD + line);
  const [first, ...rest] = note.note.split("\n");
  lines.push(`${PAD}note     ${first}`);
  for (const more of rest) lines.push(`${PAD}         ${more}`);
  lines.push(`${PAD}reply    recadro reply ${note.id} "<what you changed>"`);
  return `${lines.join("\n")}\n`;
}

/**
 * Prints every note from the lineup as it comes, and returns when the server
 * goes away. Meant to run under whatever the agent's harness has that reports
 * a command's output line by line.
 */
export function wait(setDir: string, shown: string): Promise<void> {
  const live = liveFor(setDir, shown);
  const url = new URL("/__recadro/notes/wait", live.origin);
  return new Promise((resolve, reject) => {
    const req = requestFor(url)(url, { method: "GET", headers: { [AGENT_HEADER]: "wait" } }, (res: IncomingMessage) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(gone(live, shown));
        return;
      }
      process.stdout.write(`recadro  waiting for notes from the lineup at ${live.origin}/\n${PAD}set       ${shown}\n\n`);
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          process.stdout.write(`${formatNote(JSON.parse(line) as Note)}\n`);
        }
      });
      // The server closing the connection — stopped, or killed — arrives as
      // "end" or as an abort, depending on how it went; both mean the same here.
      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        process.stdout.write(`recadro  the dev server at ${live.origin} is gone; wait ends\n`);
        resolve();
      };
      res.on("end", finish);
      res.on("close", finish);
      res.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNRESET" || error.message === "aborted") finish();
        else reject(error);
      });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ECONNREFUSED" ? gone(live, shown) : error);
    });
    req.end();
  });
}

/** Posts the agent's one line about a note; the lineup shows it at the pin. */
export function reply(setDir: string, shown: string, id: number, text: string): Promise<void> {
  const live = liveFor(setDir, shown);
  const url = new URL(`/__recadro/notes/${id}/reply`, live.origin);
  const body = JSON.stringify({ text });
  return new Promise((resolve, reject) => {
    const req = requestFor(url)(
      url,
      {
        method: "POST",
        headers: { [AGENT_HEADER]: "reply", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res: IncomingMessage) => {
        let answer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (answer += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            process.stdout.write(`recadro  reply to note ${id} shown in the lineup at ${live.origin}/\n`);
            resolve();
          } else if (res.statusCode === 404 && answer.includes("no note")) {
            reject(new Error(`no note ${id} on the server at ${live.origin}; wait prints the ids`));
          } else {
            reject(gone(live, shown));
          }
        });
      },
    );
    req.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ECONNREFUSED" ? gone(live, shown) : error);
    });
    req.end(body);
  });
}

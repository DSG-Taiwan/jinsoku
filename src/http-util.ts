import type http from "node:http";

export class BodyTooLargeError extends Error {
  constructor() {
    super("body too large");
    this.name = "BodyTooLargeError";
  }
}

export function canWrite(res: {
  headersSent: boolean;
  destroyed: boolean;
  writableEnded: boolean;
}): boolean {
  return !res.headersSent && !res.destroyed && !res.writableEnded;
}

export function readBody(req: http.IncomingMessage, maxBytes = 32_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      reject(err);
    };
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        fail(new BodyTooLargeError());
        req.pause();
        return;
      }
      chunks.push(c as Buffer);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", fail);
  });
}

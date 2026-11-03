import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MAX_DEVICE_NAME_LENGTH = 64;

export interface RemoteSession {
  readonly id?: string | undefined;
  readonly hash: string;
  readonly name?: string | undefined;
  readonly createdAt?: number | undefined;
  readonly lastSeenAt?: number | undefined;
  readonly expiresAt: number;
}

export interface PairedDeviceSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
}

export interface RemoteSessionStore {
  readonly read: () => RemoteSession[];
  readonly write: (sessions: readonly RemoteSession[]) => void;
}

export const sessionHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Deterministic public identifier derived from `hash` with a separate domain prefix when `id` was not stored. */
export const sessionPublicId = (session: Pick<RemoteSession, "id" | "hash">): string =>
  session.id ??
  createHash("sha256").update(`gram-remote-device-id:${session.hash}`).digest("hex").slice(0, 32);

export const sanitizeDeviceName = (raw: string | undefined, fallback = "Paired phone"): string => {
  if (typeof raw !== "string") return fallback;
  const cleaned = [...raw]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, MAX_DEVICE_NAME_LENGTH);
  return cleaned === "" ? fallback : cleaned;
};

export const inferDeviceNameFromUserAgent = (userAgent: string | undefined): string => {
  if (!userAgent) return "Phone browser";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android phone";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac browser";
  if (/Linux/i.test(userAgent)) return "Linux browser";
  return "Phone browser";
};

const assertPrivate = (stat: Stats, isDirectory: boolean) => {
  if (
    (isDirectory ? !stat.isDirectory() : !stat.isFile()) ||
    (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
  )
    throw new Error("Remote session storage must be a private owner-controlled file/directory");
};

const isValidOptionalTimestamp = (value: unknown): boolean =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) > 0);

const isValidSession = (session: unknown): session is RemoteSession => {
  if (typeof session !== "object" || session === null) return false;
  const s = session as Record<string, unknown>;
  if (typeof s["hash"] !== "string" || !/^[a-f0-9]{64}$/.test(s["hash"])) return false;
  if (!Number.isSafeInteger(s["expiresAt"]) || Number(s["expiresAt"]) <= 0) return false;
  if (s["id"] !== undefined && (typeof s["id"] !== "string" || !/^[a-f0-9]{16,64}$/.test(s["id"])))
    return false;
  if (
    s["name"] !== undefined &&
    (typeof s["name"] !== "string" ||
      s["name"].length === 0 ||
      s["name"].length > MAX_DEVICE_NAME_LENGTH)
  )
    return false;
  if (!isValidOptionalTimestamp(s["createdAt"]) || !isValidOptionalTimestamp(s["lastSeenAt"]))
    return false;
  return true;
};

/** Private, origin/port-bound hashes only; never persist invitation or browser bearer tokens. */
export const fileRemoteSessionStore = (
  dataDir: string,
  origin: string,
  port: number,
): RemoteSessionStore => {
  const directory = join(dataDir, "remote-access");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertPrivate(lstatSync(directory), true);
  const path = join(directory, `${sessionHash(`${origin}\n${port}`)}.json`);
  const read = (): RemoteSession[] => {
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Remote session storage could not be opened safely", { cause: error });
    }
    try {
      const stat = fstatSync(fd);
      assertPrivate(stat, false);
      if (stat.size > 4096) throw new Error("Remote session storage is invalid");
      const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
      if (typeof value !== "object" || value === null)
        throw new Error("Remote session storage is invalid");
      const record = value as Record<string, unknown>;
      if (
        record.version !== 1 ||
        record.origin !== origin ||
        record.port !== port ||
        !Array.isArray(record.sessions) ||
        record.sessions.length > 8 ||
        !record.sessions.every(isValidSession)
      )
        throw new Error("Remote session storage is invalid");
      return record.sessions;
    } finally {
      closeSync(fd);
    }
  };
  return {
    read,
    write: (sessions) => {
      // Validate current storage before replacement; never repair an insecure/corrupt file silently.
      assertPrivate(lstatSync(directory), true);
      read();
      const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
      let fd: number | undefined;
      try {
        fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        writeFileSync(fd, JSON.stringify({ version: 1, origin, port, sessions }));
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, path);
        // Persist the rename as well as file contents before granting the browser access.
        if (process.platform !== "win32") {
          const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            fsyncSync(directoryFd);
          } finally {
            closeSync(directoryFd);
          }
        }
      } finally {
        if (fd !== undefined) closeSync(fd);
        rmSync(temporary, { force: true });
      }
    },
  };
};

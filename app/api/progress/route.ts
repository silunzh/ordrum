import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { progressSnapshots } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const MAX_BYTES = 1024 * 1024;
const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

class InvalidRequest extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validState(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const maps = ["marks", "overrides", "notebook"];
  if (maps.some(key => key in value && !isObject(value[key]))) return false;
  if ("tasks" in value && (!Array.isArray(value.tasks) || value.tasks.some(task => !isObject(task)))) return false;
  if ("selectedChapters" in value && value.selectedChapters !== null && (!Array.isArray(value.selectedChapters) || value.selectedChapters.some(id => !Number.isInteger(id) || Number(id) < 1))) return false;
  if ("activeTaskId" in value && value.activeTaskId !== null && (typeof value.activeTaskId !== "string" || value.activeTaskId.length > 160)) return false;
  if (["studySession", "reviewSession"].some(key => key in value && value[key] !== null && !isObject(value[key]))) return false;
  // Snapshot fields remain forwards compatible; reject dangerous keys and deeply
  // nested input before it can reach another device's browser state merger.
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 32) return false;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every(child => visit(child, depth + 1));
    if (!isObject(item)) return true;
    return Object.entries(item).every(([key, child]) => !["__proto__", "constructor", "prototype"].includes(key) && visit(child, depth + 1));
  };
  return visit(value, 0);
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_BYTES) throw new InvalidRequest(413, "state_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidRequest(400, "invalid_payload");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new InvalidRequest(413, "state_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
  catch { throw new InvalidRequest(400, "invalid_payload"); }
  if (!isObject(payload)) throw new InvalidRequest(400, "invalid_payload");
  return payload;
}

async function accountKey(userId: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {status, headers: responseHeaders});
}

async function currentSnapshot(userId: string) {
  const db = getDb();
  const [row] = await db.select().from(progressSnapshots).where(eq(progressSnapshots.userId, userId)).limit(1);
  return row ? {state: JSON.parse(row.stateJson), revision: row.revision, lastUpdated: row.updatedAt} : {state: null, revision: 0, lastUpdated: null};
}

function routeError(error: unknown) {
  return error instanceof InvalidRequest
    ? json({error: error.code, ...(error.status === 413 ? {maxBytes: MAX_BYTES} : {})}, error.status)
    : json({error: "cloud_unavailable"}, 503);
}

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({error: "sign_in_required"}, 401);
    const snapshot = await currentSnapshot(user.userId);
    return json({...snapshot, accountId: await accountKey(user.userId)});
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({error: "sign_in_required"}, 401);
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({error: "same_origin_required"}, 403);
    }
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return json({error: "json_required"}, 415);
    const payload = await readPayload(request);
    const baseRevision = payload.baseRevision;
    const expectedAccountId = payload.expectedAccountId;
    if (typeof expectedAccountId !== "string" || !/^[a-f0-9]{64}$/.test(expectedAccountId)) {
      return json({error: "account_precondition_required"}, 400);
    }
    if (!Number.isSafeInteger(baseRevision) || Number(baseRevision) < 0 || Number(baseRevision) >= Number.MAX_SAFE_INTEGER || !validState(payload.state)) {
      return json({error: "invalid_state"}, 400);
    }
    const accountId = await accountKey(user.userId);
    // Authentication may change between the client's GET and PUT. This hash is
    // only a precondition; the authenticated user ID always selects the row.
    // Reject a stale account's payload before any INSERT or UPDATE can run.
    if (expectedAccountId !== accountId) {
      return json({...await currentSnapshot(user.userId), accountId}, 409);
    }
    const state = payload.state;
    const stateJson = JSON.stringify(state);
    const updatedAt = new Date().toISOString();
    const db = getDb();
    // Each mutation is one atomic SQL statement. A stale device receives 409
    // with the current snapshot instead of overwriting another device's work.
    const rows = baseRevision === 0
      ? await db.insert(progressSnapshots).values({userId: user.userId, stateJson, revision: 1, updatedAt})
        .onConflictDoNothing({target: progressSnapshots.userId}).returning({revision: progressSnapshots.revision})
      : await db.update(progressSnapshots).set({stateJson, revision: sql`${progressSnapshots.revision} + 1`, updatedAt})
        .where(and(eq(progressSnapshots.userId, user.userId), eq(progressSnapshots.revision, Number(baseRevision))))
        .returning({revision: progressSnapshots.revision});
    if (!rows.length) return json({...await currentSnapshot(user.userId), accountId}, 409);
    return json({state, revision: rows[0].revision, lastUpdated: updatedAt, accountId});
  } catch (error) {
    return routeError(error);
  }
}

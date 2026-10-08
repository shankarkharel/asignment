import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface RequestContextStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Returns the request's correlation id, assigning one if needed. A client-supplied
 * `X-Request-Id` is honoured only if it is short and safe (prevents log injection).
 * Idempotent so both the logger and the context middleware can call it.
 */
export function resolveRequestId(req: Request & { id?: unknown }): string {
  if (typeof req.id === 'string') return req.id;
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  return id;
}

/** Express middleware: exposes the request id via AsyncLocalStorage and echoes it in the response. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  storage.run({ requestId }, next);
}

export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;

/** Runs `fn` with a correlation id - used by the worker so job side effects share the request's id. */
export const runWithRequestId = <T>(requestId: string, fn: () => Promise<T>): Promise<T> =>
  storage.run({ requestId }, fn);

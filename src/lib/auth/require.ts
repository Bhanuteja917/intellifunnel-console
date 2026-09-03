import { ApplicationError } from "@/lib/errors";
import { getCurrentActor } from "@/lib/auth/session";
import type { Actor } from "@/lib/auth/permissions";

export async function requireActor(): Promise<Actor> {
  return getCurrentActor();
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/**
 * Server actions must return serialisable values, so expected failures become
 * results. An unexpected error is rethrown: swallowing it would hide a bug
 * behind a friendly message.
 */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApplicationError) {
      return { ok: false, error: error.message, code: error.code };
    }
    throw error;
  }
}

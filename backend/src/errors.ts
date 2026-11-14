import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/** Throw this from any route; the error handler turns it into { error: { code, message } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
    return;
  }
  if ((err as { type?: string })?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
};

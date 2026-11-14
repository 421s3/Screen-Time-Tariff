import cors from "cors";
import express from "express";
import { ApiError, errorHandler } from "./errors.js";
import { groupsRouter } from "./routes/groups.js";
import { metaRouter } from "./routes/meta.js";
import { pairingRouter } from "./routes/pairing.js";
import { trackerRouter } from "./routes/tracker.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.use(metaRouter);
  app.use(groupsRouter);
  app.use(pairingRouter);
  app.use(trackerRouter);

  app.use(() => {
    throw new ApiError(404, "NOT_FOUND", "No such endpoint");
  });
  app.use(errorHandler);
  return app;
}

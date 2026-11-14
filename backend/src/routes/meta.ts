import { Router } from "express";
import { config } from "../config.js";

export const metaRouter = Router();

metaRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Public. Tells the dashboard which program and oracle to use (contract section 4).
metaRouter.get("/config", (_req, res) => {
  res.json({
    cluster: "devnet",
    chainMode: config.chainMode, // off | mock | devnet
    programId: config.programId, // null until Dev 2 deploys
    oraclePubkey: config.oraclePubkey,
  });
});

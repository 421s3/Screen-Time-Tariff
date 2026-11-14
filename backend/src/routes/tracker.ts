import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireTracker, trackerOf } from "../auth.js";
import { config } from "../config.js";
import { groups, isDuplicateKeyError, trackers, usageBatches, usageEvents } from "../db.js";
import { ApiError } from "../errors.js";
import { capEvents } from "../services/usage.js";
import type { CurrentApp, UsageEventDoc } from "../types.js";

const matchType = z.enum(["process", "title"]);

const usageInput = z.object({
  batchId: z.string().min(8).max(100),
  sentAt: z.number().int(),
  idle: z.boolean().default(false),
  current: z.object({ app: z.string().min(1).max(100), matchType }).nullable().default(null),
  events: z
    .array(
      z.object({
        app: z.string().min(1).max(100),
        matchType,
        startedAt: z.number().int(),
        seconds: z.number().int().min(0).max(3600),
      }),
    )
    .max(500)
    .default([]),
});

export const trackerRouter = Router();

trackerRouter.get("/tracker/config", requireTracker, async (_req, res) => {
  const tracker = trackerOf(res);
  const group = await groups().findOne({ _id: tracker.groupId });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "This tracker's group no longer exists");
  res.json({
    groupId: group._id.toHexString(),
    blocklist: group.blocklist,
    periodStart: group.rules.periodStart,
    periodEnd: group.rules.periodEnd,
    sampleIntervalSec: config.sampleIntervalSec,
    reportIntervalSec: config.reportIntervalSec,
    idleThresholdSec: config.idleThresholdSec,
  });
});

// Usage batch every ~30 s. Also counts as the tracker's check-in.
trackerRouter.post("/usage", requireTracker, async (req, res) => {
  const body = usageInput.parse(req.body);
  const tracker = trackerOf(res);
  const now = Date.now();

  // Record the batch id first: a retry with the same id is acknowledged but not counted twice
  try {
    await usageBatches().insertOne({ _id: new ObjectId(), trackerId: tracker._id, batchId: body.batchId, receivedAt: now });
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      res.json({ accepted: true, duplicate: true });
      return;
    }
    throw e;
  }

  let events = body.events;
  if (config.usageRateCap) {
    const elapsedSec = tracker.lastBatchAt ? (now - tracker.lastBatchAt) / 1000 : config.reportIntervalSec;
    const result = capEvents(events, elapsedSec + config.usageCapSlackSec);
    if (result.capped) {
      console.warn(`[usage] capped batch ${body.batchId} from ${tracker.wallet}: more seconds than time elapsed`);
    }
    events = result.events;
  }

  const docs: UsageEventDoc[] = events
    .filter((e) => e.seconds > 0)
    .map((e) => ({
      _id: new ObjectId(),
      groupId: tracker.groupId,
      wallet: tracker.wallet,
      app: e.app,
      matchType: e.matchType,
      startedAt: e.startedAt,
      seconds: e.seconds,
      batchId: body.batchId,
      receivedAt: now,
    }));
  if (docs.length > 0) await usageEvents().insertMany(docs);

  // Keep "since" when they're still on the same app, so the dashboard can show how long
  const current: CurrentApp | null = body.current
    ? {
        app: body.current.app,
        matchType: body.current.matchType,
        since: tracker.current?.app === body.current.app ? tracker.current.since : now,
      }
    : null;
  await trackers().updateOne(
    { _id: tracker._id },
    { $set: { lastSeenAt: now, lastBatchAt: now, idle: body.idle, current } },
  );

  res.json({ accepted: true, duplicate: false });
});

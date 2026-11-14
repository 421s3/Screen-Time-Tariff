import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireWallet, walletOf } from "../auth.js";
import { config } from "../config.js";
import { groups, isDuplicateKeyError, pairingCodes, trackers } from "../db.js";
import { ApiError } from "../errors.js";
import type { PairingCodeDoc, TrackerDoc } from "../types.js";
import { newTrackerToken, parseGroupId, randomPairCode, sha256 } from "../util.js";

const startInput = z.object({ groupId: z.string() });
const completeInput = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "must be 6 digits"),
  deviceName: z.string().trim().min(1).max(60).default("Windows PC"),
});

export const pairingRouter = Router();

// Dashboard asks for a code to type into the tracker
pairingRouter.post("/pair/start", requireWallet, async (req, res) => {
  const body = startInput.parse(req.body);
  const groupId = parseGroupId(body.groupId);
  const wallet = walletOf(res);

  const group = await groups().findOne({ _id: groupId });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "No group with that id");
  if (!group.members.some((m) => m.wallet === wallet)) {
    throw new ApiError(403, "NOT_A_MEMBER", "Join the group before pairing a tracker");
  }

  const expiresAt = new Date(Date.now() + config.pairCodeTtlMs);
  for (let attempt = 0; attempt < 5; attempt++) {
    const doc: PairingCodeDoc = { _id: new ObjectId(), code: randomPairCode(), wallet, groupId, expiresAt, usedAt: null };
    try {
      await pairingCodes().insertOne(doc);
      res.json({ code: doc.code, expiresAt: expiresAt.getTime() });
      return;
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
    }
  }
  throw new ApiError(500, "PAIR_CODE_COLLISION", "Could not generate a pairing code. Try again.");
});

// Tracker exchanges the code for a long-lived token
pairingRouter.post("/pair/complete", async (req, res) => {
  const body = completeInput.parse(req.body);
  const now = new Date();

  // Atomically claim the code so it can only be used once
  const claimed = await pairingCodes().findOneAndUpdate(
    { code: body.code, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
  );
  if (!claimed) {
    const existing = await pairingCodes().findOne({ code: body.code });
    if (existing && !existing.usedAt && existing.expiresAt <= now) {
      throw new ApiError(410, "PAIR_CODE_EXPIRED", "That pairing code has expired. Get a new one from the dashboard.");
    }
    throw new ApiError(400, "PAIR_CODE_INVALID", "That pairing code is wrong or was already used");
  }

  const group = await groups().findOne({ _id: claimed.groupId });
  const member = group?.members.find((m) => m.wallet === claimed.wallet);
  if (!group || !member) throw new ApiError(404, "GROUP_NOT_FOUND", "The group for this code no longer exists");

  const token = newTrackerToken();
  const tracker: TrackerDoc = {
    _id: new ObjectId(),
    tokenHash: sha256(token),
    wallet: claimed.wallet,
    groupId: claimed.groupId,
    deviceName: body.deviceName,
    createdAt: now.getTime(),
    lastSeenAt: null,
    lastBatchAt: null,
    current: null,
    idle: false,
  };
  await trackers().insertOne(tracker);

  res.json({
    trackerToken: token,
    wallet: claimed.wallet,
    groupId: claimed.groupId.toHexString(),
    displayName: member.displayName,
  });
});

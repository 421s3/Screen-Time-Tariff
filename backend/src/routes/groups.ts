import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireWallet, walletOf } from "../auth.js";
import { config } from "../config.js";
import { groups, isDuplicateKeyError } from "../db.js";
import { DEFAULT_BLOCKLIST } from "../defaults.js";
import { ApiError } from "../errors.js";
import { buildGroupState } from "../services/state.js";
import type { GroupDoc } from "../types.js";
import { isPubkey, parseGroupId, randomJoinCode } from "../util.js";

const pubkey = z.string().refine(isPubkey, "not a valid Solana address");
const displayName = z.string().trim().min(1).max(30);

// Accepts the contract's { match, label } objects, or plain strings (label = match)
const blockEntry = z.union([
  z.string().trim().min(1).transform((s) => ({ match: s, label: s })),
  z.object({ match: z.string().trim().min(1), label: z.string().trim().min(1) }),
]);

const blocklistInput = z.object({
  processes: z.array(blockEntry).default([]),
  titles: z.array(blockEntry).default([]),
  browsers: z.array(z.string().trim().min(1)).optional(),
});

const rulesInput = z
  .object({
    allowanceMinutes: z.number().int().min(0),
    tariffLamportsPerMinute: z.number().int().positive(),
    periodStart: z.number().int().positive(),
    periodEnd: z.number().int().positive(),
    demoMode: z.boolean().default(false),
  })
  .refine((r) => r.periodEnd > r.periodStart, { message: "periodEnd must be after periodStart", path: ["periodEnd"] });

const createGroupInput = z.object({
  name: z.string().trim().min(1).max(60),
  displayName,
  // Optional until the program is deployed (see docs/contract.md section 4)
  groupPda: pubkey.optional(),
  groupSeed: z.string().regex(/^\d+$/, "must be a u64 written as a decimal string").optional(),
  createSignature: z.string().min(1).optional(),
  rules: rulesInput,
  blocklist: blocklistInput.optional(),
});

const joinInput = z.object({
  joinCode: z.string().trim().toUpperCase().length(6),
  displayName,
});

const stakeInput = z.object({
  lamports: z.number().int().positive(),
  signature: z.string().min(1),
});

export const groupsRouter = Router();

groupsRouter.post("/groups", requireWallet, async (req, res) => {
  const body = createGroupInput.parse(req.body);
  const wallet = walletOf(res);
  const now = Date.now();

  // Retry in the unlikely case the random join code is taken
  for (let attempt = 0; attempt < 5; attempt++) {
    const group: GroupDoc = {
      _id: new ObjectId(),
      name: body.name,
      joinCode: randomJoinCode(),
      adminWallet: wallet,
      groupPda: body.groupPda ?? null,
      groupSeed: body.groupSeed ?? null,
      createSignature: body.createSignature ?? null,
      rules: body.rules,
      blocklist: body.blocklist ?? DEFAULT_BLOCKLIST,
      members: [{ wallet, displayName: body.displayName, joinedAt: now, stakedLamports: 0, stakeSignatures: [] }],
      createdAt: now,
    };
    try {
      await groups().insertOne(group);
      res.status(201).json({ groupId: group._id.toHexString(), joinCode: group.joinCode });
      return;
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
    }
  }
  throw new ApiError(500, "JOIN_CODE_COLLISION", "Could not generate a unique join code. Try again.");
});

groupsRouter.post("/groups/join", requireWallet, async (req, res) => {
  const body = joinInput.parse(req.body);
  const wallet = walletOf(res);
  const group = await groups().findOne({ joinCode: body.joinCode });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "No group with that join code");

  const alreadyMember = group.members.some((m) => m.wallet === wallet);
  if (!alreadyMember) {
    if (Date.now() > group.rules.periodEnd) throw new ApiError(409, "PERIOD_ENDED", "This group's period has ended");
    if (group.members.length >= config.maxMembers) {
      throw new ApiError(409, "GROUP_FULL", `Groups are limited to ${config.maxMembers} members`);
    }
    // Conditions guard against a double-join or overfilling under concurrent requests
    const result = await groups().updateOne(
      { _id: group._id, "members.wallet": { $ne: wallet }, [`members.${config.maxMembers - 1}`]: { $exists: false } },
      {
        $push: {
          members: { wallet, displayName: body.displayName, joinedAt: Date.now(), stakedLamports: 0, stakeSignatures: [] },
        },
      },
    );
    if (result.matchedCount === 0) {
      const fresh = await groups().findOne({ _id: group._id });
      if (!fresh?.members.some((m) => m.wallet === wallet)) {
        throw new ApiError(409, "GROUP_FULL", `Groups are limited to ${config.maxMembers} members`);
      }
    }
  }

  res.json({ groupId: group._id.toHexString(), groupPda: group.groupPda, rules: group.rules });
});

groupsRouter.post("/groups/:groupId/stakes", requireWallet, async (req, res) => {
  const groupId = parseGroupId(req.params.groupId);
  const body = stakeInput.parse(req.body);
  const wallet = walletOf(res);

  const group = await groups().findOne({ _id: groupId });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "No group with that id");
  const member = group.members.find((m) => m.wallet === wallet);
  if (!member) throw new ApiError(403, "NOT_A_MEMBER", "Join the group before staking");

  // Recording the same transaction twice must not double the stake
  if (!member.stakeSignatures.includes(body.signature)) {
    await groups().updateOne(
      { _id: groupId, members: { $elemMatch: { wallet, stakeSignatures: { $ne: body.signature } } } },
      { $inc: { "members.$.stakedLamports": body.lamports }, $push: { "members.$.stakeSignatures": body.signature } },
    );
  }
  res.json({ ok: true });
});

// Public so the projector screen can poll it without a wallet
groupsRouter.get("/groups/:groupId/state", async (req, res) => {
  res.json(await buildGroupState(parseGroupId(req.params.groupId)));
});

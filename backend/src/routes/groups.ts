import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireWallet, walletOf } from "../auth.js";
import { type Chain, FakeChain, getChain } from "../chain/index.js";
import { FakeChainError } from "../chain/fakeChain.js";
import { config } from "../config.js";
import { groups, isDuplicateKeyError } from "../db.js";
import { DEFAULT_BLOCKLIST } from "../defaults.js";
import { ApiError } from "../errors.js";
import { buildGroupState } from "../services/state.js";
import type { GroupDoc, Rules } from "../types.js";
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
  steamGames: z.boolean().optional(),
});

const rulesInput = z
  .object({
    allowanceMinutes: z.number().int().min(0).optional(),
    // Finer allowance for testing (e.g. 30). Used when penalties are charged by the second.
    allowanceSeconds: z.number().int().min(0).max(31 * 24 * 3600).optional(),
    tariffLamportsPerMinute: z.number().int().positive(),
    periodStart: z.number().int().positive(),
    periodEnd: z.number().int().positive(),
    demoMode: z.boolean().default(false),
  })
  .refine((r) => r.periodEnd > r.periodStart, { message: "periodEnd must be after periodStart", path: ["periodEnd"] })
  .refine((r) => r.allowanceMinutes !== undefined || r.allowanceSeconds !== undefined, {
    message: "send allowanceMinutes or allowanceSeconds",
    path: ["allowanceMinutes"],
  })
  // The program stores whole minutes; a seconds-only allowance is rounded down for it
  .transform(({ allowanceSeconds, ...r }) => ({
    ...r,
    allowanceMinutes: r.allowanceMinutes ?? Math.floor(allowanceSeconds! / 60),
    ...(allowanceSeconds !== undefined ? { allowanceSeconds } : {}),
  }));

const createGroupInput = z.object({
  name: z.string().trim().min(1).max(60),
  displayName,
  // Optional until the program is deployed (see docs/contract.md section 4)
  groupPda: pubkey.optional(),
  groupSeed: z.string().regex(/^\d+$/, "must be a u64 written as a decimal string").optional(),
  createSignature: z.string().min(1).optional(),
  rules: rulesInput,
  blocklist: blocklistInput.optional(),
  // false = the backend never settles this group, so members get emergency_refund (refund demo)
  autoSettle: z.boolean().optional(),
  // Mock mode only (devnet reads it from the chain): settle window length in seconds
  graceSecs: z.number().int().positive().optional(),
  // Seconds per charge unit: 5 = charged every 5 s over, and the on-chain tariff is per 5 s.
  // Missing = 60 (per minute), which is what dashboards before v0.9 create.
  chargeUnitSecs: z.union([z.literal(5), z.literal(60)]).default(60),
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

/** Polls the chain a few times: an account written by a just-confirmed transaction can lag briefly. */
async function fetchWithRetry<T>(fn: () => Promise<T | null>, tries = 4, delayMs = 1000): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/** Turns an on-chain group into the backend's rules, checking it's really ours. */
async function onchainRules(
  chain: Chain,
  wallet: string,
  groupPda: string | undefined,
  groupSeed: string | undefined,
  rules: Rules,
  unitSecs: number,
): Promise<{ rules: Rules; graceSecs: number }> {
  if (!groupPda || !groupSeed) {
    throw new ApiError(400, "ONCHAIN_GROUP_REQUIRED", "Create the group on-chain first, then send groupPda and groupSeed");
  }
  if (chain.groupPda(wallet, groupSeed) !== groupPda) {
    throw new ApiError(400, "GROUP_PDA_MISMATCH", "groupPda doesn't match your wallet and groupSeed");
  }
  const onchain = await fetchWithRetry(() => chain.fetchGroup(groupPda));
  if (!onchain) throw new ApiError(409, "GROUP_NOT_ON_CHAIN", "That group account doesn't exist on-chain (yet)");
  if (onchain.oracle !== config.oraclePubkey) {
    throw new ApiError(409, "WRONG_ORACLE", `The group's oracle must be ${config.oraclePubkey}`);
  }
  const periodEnd = onchain.periodEndSec * 1000;
  // The chain is the source of truth for the money rules; periodStart only exists off-chain.
  // It only knows whole minutes, so a finer allowanceSeconds is dropped.
  const { allowanceSeconds: _dropped, ...rest } = rules;
  return {
    rules: {
      ...rest,
      allowanceMinutes: onchain.allowanceMinutes,
      // The chain's tariff is per charge unit; the API always talks lamports per minute
      tariffLamportsPerMinute: Math.round((onchain.tariffLamportsPerMin * 60) / unitSecs),
      periodEnd,
      periodStart: Math.min(rules.periodStart, periodEnd - 1),
    },
    graceSecs: onchain.graceSecs,
  };
}

/** Warn when the settle window is too short for the worker to settle reliably. */
function warnIfShortGrace(name: string, graceSecs: number, autoSettle: boolean): void {
  const neededSec = config.settleDelayMs / 1000 + 2 * config.workerIntervalSec;
  if (autoSettle && graceSecs < neededSec) {
    console.warn(
      `[groups] "${name}" has grace_secs=${graceSecs}, shorter than the ~${neededSec}s the backend needs to settle. ` +
        "Use 600 (contract section 6).",
    );
  }
}

groupsRouter.post("/groups", requireWallet, async (req, res) => {
  const body = createGroupInput.parse(req.body);
  const wallet = walletOf(res);
  const now = Date.now();
  const chain = getChain();

  let rules: Rules = body.rules;
  let groupPda = body.groupPda ?? null;
  let groupSeed = body.groupSeed ?? null;
  let graceSecs: number | null = null;
  const autoSettle = body.autoSettle ?? true;
  const unitSecs = body.chargeUnitSecs;
  if (chain instanceof FakeChain) {
    // Mock mode: do create_group on the creator's behalf
    groupSeed = groupSeed ?? String(now);
    graceSecs = body.graceSecs ?? config.graceSecs;
    // Same rounding the dashboard does for the real program: the chain stores lamports per unit
    const perUnit = Math.max(1, Math.round((rules.tariffLamportsPerMinute * unitSecs) / 60));
    rules = { ...rules, tariffLamportsPerMinute: Math.round((perUnit * 60) / unitSecs) };
    try {
      groupPda = chain.createGroup(wallet, groupSeed, {
        allowanceMinutes: rules.allowanceMinutes,
        tariffLamportsPerMin: perUnit,
        periodEndSec: Math.floor(rules.periodEnd / 1000),
        graceSecs,
      });
    } catch (e) {
      if (e instanceof FakeChainError) throw new ApiError(409, "CHAIN_REJECTED", e.message);
      throw e;
    }
  } else if (chain) {
    ({ rules, graceSecs } = await onchainRules(chain, wallet, body.groupPda, body.groupSeed, rules, unitSecs));
  }
  if (graceSecs !== null) warnIfShortGrace(body.name, graceSecs, autoSettle);

  // Retry in the unlikely case the random join code is taken
  for (let attempt = 0; attempt < 5; attempt++) {
    const group: GroupDoc = {
      _id: new ObjectId(),
      name: body.name,
      joinCode: randomJoinCode(),
      adminWallet: wallet,
      groupPda,
      groupSeed,
      createSignature: body.createSignature ?? null,
      rules,
      blocklist: body.blocklist ?? DEFAULT_BLOCKLIST,
      members: [{ wallet, displayName: body.displayName, joinedAt: now, stakedLamports: 0, stakeSignatures: [] }],
      createdAt: now,
      graceSecs,
      autoSettle,
      chargeUnitSecs: unitSecs,
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

  const chain = getChain();
  if (chain) {
    // The stake lives on-chain: record what the Member account says, not what the request says
    const pda = group.groupPda;
    if (!pda) throw new ApiError(409, "GROUP_NOT_ON_CHAIN", "This group has no on-chain address");
    if (chain instanceof FakeChain) {
      const existing = (await chain.fetchMembers(pda, [wallet])).get(wallet);
      if (!existing) {
        try {
          chain.joinAndStake(pda, wallet, body.lamports); // mock: join_and_stake on the user's behalf
        } catch (e) {
          if (e instanceof FakeChainError) throw new ApiError(409, "CHAIN_REJECTED", e.message);
          throw e;
        }
      }
    }
    const onchain = await fetchWithRetry(async () => (await chain.fetchMembers(pda, [wallet])).get(wallet) ?? null);
    if (!onchain) throw new ApiError(409, "STAKE_NOT_FOUND", "No on-chain stake found for your wallet in this group");
    await groups().updateOne(
      { _id: groupId, "members.wallet": wallet },
      {
        $set: { "members.$.stakedLamports": onchain.deposited, "members.$.onchain": onchain },
        $addToSet: { "members.$.stakeSignatures": body.signature },
      },
    );
    res.json({ ok: true });
    return;
  }

  // CHAIN_MODE=off: self-reported. Recording the same transaction twice must not double the stake
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

import type { RequestHandler, Response } from "express";
import type { WithId } from "mongodb";
import { trackers } from "./db.js";
import { ApiError } from "./errors.js";
import type { TrackerDoc } from "./types.js";
import { isPubkey, sha256 } from "./util.js";

/**
 * Dashboard auth, contract v1: the wallet address in the X-Wallet header, NOT verified.
 * Stretch: verify a Phantom-signed message instead.
 */
export const requireWallet: RequestHandler = (req, res, next) => {
  const wallet = req.header("x-wallet");
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Send your wallet address in the X-Wallet header");
  if (!isPubkey(wallet)) throw new ApiError(400, "INVALID_WALLET", "X-Wallet is not a valid Solana address");
  res.locals.wallet = wallet;
  next();
};

/** Tracker auth: `Authorization: Bearer trk_...` from /pair/complete. */
export const requireTracker: RequestHandler = async (req, res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  if (!match?.[1]) {
    throw new ApiError(401, "TRACKER_TOKEN_REQUIRED", "Send the tracker token as Authorization: Bearer <token>");
  }
  const tracker = await trackers().findOne({ tokenHash: sha256(match[1]) });
  if (!tracker) throw new ApiError(401, "TRACKER_TOKEN_INVALID", "Unknown tracker token. Pair the tracker again.");
  res.locals.tracker = tracker;
  next();
};

export const walletOf = (res: Response): string => res.locals.wallet as string;
export const trackerOf = (res: Response): WithId<TrackerDoc> => res.locals.tracker as WithId<TrackerDoc>;

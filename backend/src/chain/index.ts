import { Keypair, PublicKey } from "@solana/web3.js";
import { config } from "../config.js";
import { AnchorChain } from "./anchorChain.js";
import { FakeChain } from "./fakeChain.js";
import type { Chain } from "./types.js";

/** Address baked into Xayden's IDL; used for PDA math in mock mode when PROGRAM_ID isn't set. */
export const IDL_PROGRAM_ID = "GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi";

let chain: Chain | null | undefined;

function createChain(): Chain | null {
  switch (config.chainMode) {
    case "off":
      return null;
    case "mock":
      return new FakeChain(
        new PublicKey(config.programId ?? IDL_PROGRAM_ID),
        config.oraclePubkey ?? Keypair.generate().publicKey.toBase58(),
      );
    case "devnet":
      if (!config.programId) throw new Error("CHAIN_MODE=devnet needs PROGRAM_ID in backend/.env");
      if (!config.oracle) throw new Error(`CHAIN_MODE=devnet needs the oracle keypair at ${config.oracleKeypairPath}`);
      return new AnchorChain(config.rpcUrl, config.programId, config.oracle);
  }
}

/** The configured chain, or null when CHAIN_MODE=off (CP1 behavior: penalties stay pending). */
export function getChain(): Chain | null {
  if (chain === undefined) chain = createChain();
  return chain;
}

/** Tests only: swap the chain implementation. */
export function setChain(next: Chain | null): void {
  chain = next;
}

export { FakeChain } from "./fakeChain.js";
export type { Chain, ChainMode, OnchainGroup, OnchainMember } from "./types.js";

import { getChain } from "./chain/index.js";
import { syncAndSend } from "./services/chainSync.js";
import { runPenaltyTick } from "./services/penalties.js";
import { runSettlement } from "./services/settlement.js";
import { formatSol } from "./util.js";

/** One worker pass: create pending penalties → sync + send them on-chain → settle ended groups. */
export async function runWorkerTick(now = Date.now()): Promise<void> {
  for (const p of await runPenaltyTick(now)) {
    console.log(`[worker] new penalty: ${p.displayName} ${p.minutes} min (${p.app}) ≈ ${formatSol(p.lamports)}`);
  }
  const chain = getChain();
  if (!chain) return; // CHAIN_MODE=off: penalties stay pending

  for (const p of await syncAndSend(chain, now)) {
    console.log(`[worker] slashed ${p.displayName}: ${formatSol(p.lamports)} into the pool (${p.signature})`);
  }
  for (const s of await runSettlement(chain, now)) {
    const who = s.winners.map((w) => `${w.displayName} +${formatSol(w.prizeLamports)}`).join(", ");
    console.log(`[worker] settlement ${s.status}: pool ${formatSol(s.poolLamports)} → ${who || "nobody"}`);
  }
}

/** Runs runWorkerTick every `intervalSec`, never overlapping. Returns a function that stops it. */
export function startWorker(intervalSec: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runWorkerTick();
    } catch (e) {
      console.error("[worker] tick failed:", e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalSec * 1000);
  void tick();
  return () => clearInterval(timer);
}

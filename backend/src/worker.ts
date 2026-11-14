import { runPenaltyTick } from "./services/penalties.js";
import { formatSol } from "./util.js";

/** Runs the penalty engine every `intervalSec`. Returns a function that stops it. */
export function startWorker(intervalSec: number): () => void {
  let running = false;

  const tick = async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      for (const p of await runPenaltyTick()) {
        const to = p.recipients.map((r) => r.displayName).join(", ");
        console.log(
          `[worker] pending penalty: ${p.displayName} ${p.minutes} min (${p.app}) = ${formatSol(p.lamports)} → ${to}`,
        );
      }
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

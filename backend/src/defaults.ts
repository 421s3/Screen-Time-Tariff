import type { Blocklist } from "./types.js";

/** Used when POST /groups doesn't send a blocklist. Same entries as tracker/blocklist.json. */
export const DEFAULT_BLOCKLIST: Blocklist = {
  processes: [
    { match: "VALORANT-Win64-Shipping.exe", label: "Valorant" },
    { match: "League of Legends.exe", label: "League of Legends" },
    { match: "Discord.exe", label: "Discord" },
  ],
  // Steam-launched games, not the Steam client. A group can still list steam.exe in processes.
  steamGames: true,
  titles: [
    { match: "TikTok", label: "TikTok" },
    { match: "YouTube", label: "YouTube" },
    { match: "Reddit", label: "Reddit" },
    { match: "Instagram", label: "Instagram" },
    { match: "Twitch", label: "Twitch" },
  ],
  browsers: [
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "opera_gx.exe",
    "vivaldi.exe",
    "arc.exe",
  ],
};

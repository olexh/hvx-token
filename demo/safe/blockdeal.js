/**
 * Block deal logic for the HVX Block Deals Safe App: network addresses, input checks, plain-English
 * summaries and the Safe transactions. No DOM code, so the tests run it against the real contracts.
 * Every function that needs ethers v6 takes it as the first argument.
 */

export const NETWORKS = {
  56: {
    name: "BNB Smart Chain",
    safePrefix: "bnb",
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    explorer: "https://bscscan.com",
    token: "0x252Ce29d2a58B70f98fe80a67773747770Bb0028",
    vault: "0x04d4D102eed59b34A1A6527b48cCa690daEeC8a3",
    safe: "0xc5748294eE8884E7ac0bf27E0978cBA4c81b6d75",
  },
  97: {
    name: "BNB Smart Chain Testnet",
    safePrefix: null,
    rpcUrl: "https://bsc-testnet-rpc.publicnode.com",
    explorer: "https://testnet.bscscan.com",
    token: "0xB92f8c1e40D83389c70Bb654F83a71B8f4979d69",
    vault: "0x414e9FA80ED96BA5181B7ab1aCeBFcA342C0C20C",
    safe: "0x2D2A15e9c774166B8E2638dCbf989848e73c0F68",
  },
};

export const TOKEN_ABI = ["function balanceOf(address) view returns (uint256)", "function approve(address spender, uint256 value) returns (bool)"];
export const VAULT_ABI = ["function owner() view returns (address)", "function schedulesOf(address beneficiary) view returns (uint256[])", "function createSchedule(address beneficiary, string label, uint256 total, uint64 start, uint64 cliffDuration, uint64 vestingDuration, uint16 initialUnlockBps, bool revocable) returns (uint256 id)"];

export const LABEL_PREFIX = "Block deal - ";
const MAX_NAME = 48;
const MAX_MONTHS = 600;

/** Adds calendar months in UTC, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUTC(ts, months) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000;
}

/** "100,000,000" or "1500.5" HVX -> base units. Returns null when the text is not a positive amount. */
export function parseAmount(ethers, text) {
  const s = String(text ?? "").replace(/[\s,_]/g, "");
  if (!/^\d+(\.\d{1,18})?$/.test(s)) return null;
  const wei = ethers.parseUnits(s, 18);
  return wei > 0n ? wei : null;
}

/** "20" or "12.5" percent -> basis points. Returns null when outside 0-100 or more than 2 decimals. */
export function parsePercent(text) {
  const s = String(text ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps <= 10_000 ? bps : null;
}

function parseMonths(text) {
  const s = String(text ?? "").trim() || "0";
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_MONTHS ? n : null;
}

/** "2027-10-05" + "14:30" (UTC) -> Unix seconds, or null. */
export function parseUnlock(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return null;
  const t = time || "00:00";
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const ms = Date.parse(`${date}T${t}:00Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/**
 * Checks one buyer's form input and turns it into createSchedule arguments.
 * The lock-up is the schedule start: nothing vests before it. Buyer schedules are never revocable.
 *
 * @param input { name, wallet, amount, unlockDate, unlockTime, unlockPercent, vestingMonths, pauseMonths }
 * @param net   entry of NETWORKS (plus the Safe address in use)
 * @param now   current Unix seconds
 * @returns { errors: { field: message }, schedule | null }
 */
export function buildSchedule(ethers, input, net, safe, now) {
  const errors = {};

  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Enter a name for this buyer, e.g. Buyer A.";
  else if (name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters.`;

  let beneficiary = null;
  const wallet = String(input.wallet ?? "").trim();
  if (!wallet) errors.wallet = "Enter the buyer's wallet address.";
  else {
    try { beneficiary = ethers.getAddress(wallet); }
    catch { errors.wallet = /^0x[0-9a-fA-F]{40}$/.test(wallet) ? "Address checksum doesn't match. Copy the address again." : "Not a valid address (0x followed by 40 characters)."; }
    const same = (a) => a && beneficiary && a.toLowerCase() === beneficiary.toLowerCase();
    if (beneficiary === ethers.ZeroAddress) errors.wallet = "The zero address can't receive tokens.";
    else if (same(net.vault)) errors.wallet = "This is the vesting vault itself, not a buyer wallet.";
    else if (same(net.token)) errors.wallet = "This is the HVX token contract, not a buyer wallet.";
    else if (same(safe)) errors.wallet = "This is the Foundation Safe, not a buyer wallet.";
  }

  const total = parseAmount(ethers, input.amount);
  if (total === null) errors.amount = "Enter an HVX amount greater than 0, e.g. 100,000,000.";

  const start = parseUnlock(input.unlockDate, input.unlockTime);
  if (start === null) errors.unlockDate = "Pick the unlock date.";
  else if (start <= now) errors.unlockDate = "The unlock date must be in the future.";

  const initialUnlockBps = parsePercent(input.unlockPercent);
  if (initialUnlockBps === null) errors.unlockPercent = "Enter a percentage from 0 to 100.";

  let vestingMonths = 0, pauseMonths = 0;
  if (initialUnlockBps !== null && initialUnlockBps < 10_000) {
    vestingMonths = parseMonths(input.vestingMonths);
    pauseMonths = parseMonths(input.pauseMonths);
    if (vestingMonths === null || vestingMonths < 1) errors.vestingMonths = `Enter whole months from 1 to ${MAX_MONTHS}.`;
    if (pauseMonths === null) errors.pauseMonths = `Enter whole months from 0 to ${MAX_MONTHS}.`;
  }

  if (Object.keys(errors).length) return { errors, schedule: null };

  const cliffEnd = addMonthsUTC(start, pauseMonths);
  const end = addMonthsUTC(cliffEnd, vestingMonths);
  return {
    errors,
    schedule: {
      name,
      beneficiary,
      label: LABEL_PREFIX + name,
      total,
      start: BigInt(start),
      cliffDuration: BigInt(cliffEnd - start),
      vestingDuration: BigInt(end - cliffEnd),
      initialUnlockBps,
      revocable: false,
    },
  };
}

export function formatHVX(ethers, wei) {
  const [whole, frac = ""] = ethers.formatUnits(wei, 18).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac.replace(/0+$/, "");
  return f ? `${grouped}.${f}` : grouped;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
export const formatDate = (ts) => DATE_FMT.format(new Date(Number(ts) * 1000)) + " UTC";

/** Plain-English description of a schedule, one sentence per line. */
export function describeSchedule(ethers, s) {
  const hvx = (w) => `${formatHVX(ethers, w)} HVX`;
  const pct = (bps) => `${bps / 100}%`;
  const start = s.start, cliffEnd = s.start + s.cliffDuration, end = cliffEnd + s.vestingDuration;
  const lines = [`Nothing can be claimed before ${formatDate(start)}.`];
  if (s.initialUnlockBps === 10_000) {
    lines.push(`On ${formatDate(start)} all ${hvx(s.total)} become claimable.`);
  } else {
    const initial = (s.total * BigInt(s.initialUnlockBps)) / 10_000n;
    if (initial > 0n) lines.push(`On ${formatDate(start)} ${hvx(initial)} (${pct(s.initialUnlockBps)}) become claimable.`);
    if (s.cliffDuration > 0n) lines.push(`Nothing more until ${formatDate(cliffEnd)}.`);
    lines.push(`The remaining ${hvx(s.total - initial)} are released gradually, every second, until ${formatDate(end)}.`);
  }
  lines.push("The Foundation can't cancel this schedule, change it or release tokens early.");
  return lines;
}

/** Safe transactions: one approve for the batch total, then one createSchedule per buyer. */
export function buildTransactions(ethers, net, schedules) {
  if (!schedules.length) throw new Error("No schedules");
  const tokenIface = new ethers.Interface(TOKEN_ABI), vaultIface = new ethers.Interface(VAULT_ABI);
  const total = schedules.reduce((sum, s) => sum + s.total, 0n);
  return [
    { to: net.token, value: "0", data: tokenIface.encodeFunctionData("approve", [net.vault, total]) },
    ...schedules.map((s) => ({
      to: net.vault,
      value: "0",
      data: vaultIface.encodeFunctionData("createSchedule", [s.beneficiary, s.label, s.total, s.start, s.cliffDuration, s.vestingDuration, s.initialUnlockBps, false]),
    })),
  ];
}

/** Safe Transaction Builder import file, same format as scripts/schedules.ts. */
export function txBuilderFile(ethers, chainId, safe, schedules, txs) {
  const total = schedules.reduce((sum, s) => sum + s.total, 0n);
  return {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name: "HVX block deal schedules",
      description: `approve + ${schedules.length} createSchedule (total ${formatHVX(ethers, total)} HVX): ${schedules.map((s) => s.name).join(", ")}`,
      createdFromSafeAddress: safe,
    },
    transactions: txs.map((t) => ({ to: t.to, value: t.value, data: t.data, contractMethod: null, contractInputsValues: null })),
  };
}

// The Peer Radar model: one snapshot of the protocol universe in, one ranked board out.
//
// Where the house model prices every pre-token protocol off one flat multiple of TVL, this model
// prices each protocol off its own category's evidence. The snapshot's tokened protocols are the
// market's own verdict on what a dollar of TVL is worth in a category: their market-cap-to-TVL
// ratios, medianed per category, are the multiples. A pre-token protocol is then priced the way
// the market already prices its launched neighbours, adjusted for its own seven-day growth and
// for how long it has run with no token:
//
//   peers        = the snapshot's tokened protocols in the same category (mcap and TVL both held)
//   peerMultiple = median(mcap / tvl over peers), clamped to [0.03, 2.5]; with fewer than 3 peers
//                  the whole market's median stands in, and the row says which scope priced it
//   growthMult   = 1 + clamp(change_7d, -50, 100) / 100 x 0.45   (no reported change: 1)
//   maturityMult = 0.65 + 0.35 x sqrt(min(age_days, 1460) / 1460)   (unknown age: 0.85)
//   implied      = max(1, round(tvl x peerMultiple x growthMult x maturityMult))
//
// The board ranks every rankable pre-token protocol in the snapshot, not a slice by size: the
// watchlist is the floor and is always covered, and the early protocols below it are the radar's
// reason to exist. Rankable carries the watchlist's own product rule at every size (see
// isRankable): a wrapped, staked or bridged product of a token that already trades is not a
// launch candidate. Protocols whose token already trades are never ranked either; they are the
// peer evidence, and the dashboard shows them apart, at the market's own values. No protocol
// name is ever special-cased: one function scores every row, and every row carries its own
// arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peer-1';

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic. */
export const MODEL = {
  peer_min_count: 3,
  peer_clamp_lo: 0.03,
  peer_clamp_hi: 2.5,
  growth_weight: 0.45,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_mult: 0.85,
  live_rows: 36,
};

/** One row of board.json: the ranked board's row, with the arithmetic that priced it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_scope: string;
    growth_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's peer evidence: the multiple and how many tokened protocols stand behind it. */
export interface PeerStat {
  category: string;
  multiple: number;
  peers: number;
  scope: string;
}

/** Everything the dashboard needs: the board, the live set, the peer table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  peers: PeerStat[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a product of another token: wrapped, staked, staking. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchanges whose own-name products the watchlist rule sets aside. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories that are products of a token that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is one the board may rank. The board applies the watchlist's own product
 * rule at every size, not only above its floor: a wrapped, staked or bridged product of a token
 * that already trades (WBTC, Binance staked ETH, USDT0 and their kin) is not a token that does
 * not exist yet, so it is never ranked as a launch candidate, whatever its TVL. What remains is
 * pre-token, not a product category, not a versioned pool, not an exchange's own product and
 * carries no wrapped/staked marker in its name.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const clampMult = (n: number): number => Math.min(MODEL.peer_clamp_hi, Math.max(MODEL.peer_clamp_lo, n));

/**
 * The peer evidence: for every category, the median market-cap-to-TVL ratio of the snapshot's
 * tokened protocols in it, plus the market-wide median every thin category falls back to.
 */
export function peerTable(snapshot: Snapshot): { byCategory: Map<string, PeerStat>; global: PeerStat } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    all.push(r);
    if (p.category !== null) {
      const list = ratios.get(p.category) ?? [];
      list.push(r);
      ratios.set(p.category, list);
    }
  }
  const global: PeerStat = {
    category: '(all categories)',
    multiple: round4(clampMult(median(all))),
    peers: all.length,
    scope: 'the whole market',
  };
  const byCategory = new Map<string, PeerStat>();
  for (const [category, list] of ratios) {
    if (list.length >= MODEL.peer_min_count) {
      byCategory.set(category, { category, multiple: round4(clampMult(median(list))), peers: list.length, scope: `${list.length} tokened ${category} protocols` });
    } else {
      byCategory.set(category, { category, multiple: global.multiple, peers: list.length, scope: `the whole market (only ${list.length} tokened ${category} peer${list.length === 1 ? '' : 's'})` });
    }
  }
  return { byCategory, global };
}

/** The peer stat that prices one protocol: its category's when the category has one, else the market's. */
function peerFor(p: SnapshotProtocol, table: { byCategory: Map<string, PeerStat>; global: PeerStat }): PeerStat {
  if (p.category !== null) {
    const stat = table.byCategory.get(p.category);
    if (stat !== undefined) return stat;
    return { category: p.category, multiple: table.global.multiple, peers: 0, scope: 'the whole market (no tokened peer in its category)' };
  }
  return { category: '(uncategorised)', multiple: table.global.multiple, peers: 0, scope: 'the whole market (no category recorded)' };
}

/** One protocol's implied value and the multipliers behind it, under the peer model. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  table: { byCategory: Map<string, PeerStat>; global: PeerStat },
): { implied: number; peer: PeerStat; growthMult: number; maturityMult: number; age: number | null } {
  const peer = peerFor(p, table);
  const age = ageDays(asOf, p.listed_at);
  const growthPct = p.change_7d === null ? 0 : Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, p.change_7d));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const maturityMult =
    age === null
      ? MODEL.unknown_age_mult
      : MODEL.maturity_floor + MODEL.maturity_range * Math.sqrt(Math.min(age, MODEL.maturity_days) / MODEL.maturity_days);
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * growthMult * maturityMult));
  return { implied, peer, growthMult, maturityMult, age };
}

// ---- Farm plans -------------------------------------------------------------
//
// Every plan is built from the protocol's own record: its category picks the playbook, its chains
// pick the route (the cheapest chain it runs on, at the per-chain action costs below), its TVL
// picks the position size, and its age picks the hold. Costs are typical 2026 on-chain fees and
// are stated as estimates in the step text itself; no plan names a figure the record cannot size.

/** A typical all-in cost, in dollars, of one deposit or swap action on a chain. */
const CHAIN_ACTION_COST: Record<string, number> = {
  Ethereum: 8, Solana: 0.05, Base: 0.15, 'Arbitrum One': 0.25, 'OP Mainnet': 0.2, BSC: 0.3,
  Polygon: 0.05, Avalanche: 0.4, Linea: 0.3, Scroll: 0.3, 'zkSync Era': 0.25, Mantle: 0.1,
  Blast: 0.1, Berachain: 0.2, Sui: 0.05, Aptos: 0.05, Near: 0.02, Tron: 1.2, Bitcoin: 2.5,
  Gnosis: 0.05, Fantom: 0.1, Sonic: 0.05, Celo: 0.05, Starknet: 0.2, Mode: 0.1, Taiko: 0.2,
  Fraxtal: 0.1, Hyperliquid: 0.05, Osmosis: 0.05, Sei: 0.02, Injective: 0.02, TON: 0.05,
  Cardano: 0.2, Algorand: 0.01, Tezos: 0.05, Zora: 0.1, Unichain: 0.1, Ink: 0.1, Worldchain: 0.1,
};
const DEFAULT_ACTION_COST = 0.5;

/** The cheapest chain a protocol runs on, and what one action there costs. */
function cheapestChain(p: SnapshotProtocol): { chain: string; cost: number } {
  let best: { chain: string; cost: number } | null = null;
  for (const chain of p.chains) {
    const cost = CHAIN_ACTION_COST[chain] ?? DEFAULT_ACTION_COST;
    if (best === null || cost < best.cost) best = { chain, cost };
  }
  return best ?? { chain: 'its main chain', cost: DEFAULT_ACTION_COST };
}

/** A dollar figure the way a reader says it: cents under a dollar, whole dollars above. */
function money(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core and follow-up actions, in the words a farmer can follow. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('bridge')) return {
    core: `Bridge ${money(capital)} of USDC from Ethereum to ${chain} through ${n}, then bridge a smaller amount back a week later so both directions count.`,
    second: `Repeat the route with a second asset (ETH or USDT) so the wallet shows varied, non-identical crossings rather than one repeated amount.`,
  };
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked') || c.includes('staking pool')) return {
    core: `Stake ${money(capital)} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the same wallet.`,
    second: `Use the receipt token once in a money market or pool that ${n} lists as a partner, so the position earns both staking and DeFi activity.`,
  };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return {
    core: `Supply ${money(capital)} of USDC to ${n} on ${chain}; if it is a CDP, mint its stablecoin against part of the collateral instead of borrowing.`,
    second: `Borrow about 30% against the position and re-supply it once, keeping the health factor above 2 so a normal price swing cannot liquidate you.`,
  };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return {
    core: `Deposit ${money(capital)} of USDC as margin on ${n} and open one small hedged pair (long and short of equal size) so volume accrues without directional risk.`,
    second: `Close and reopen the hedge weekly rather than daily: the same volume at a fraction of the fees, and a pattern that reads as use, not wash trading.`,
  };
  if (c.includes('dex') || c.includes('swap')) return {
    core: `Add ${money(capital)} of liquidity to ${n}'s busiest stable or ETH pool on ${chain}, in range, and leave it through at least one fee cycle.`,
    second: `Make two or three real swaps a week through ${n}'s own interface at varied sizes, so the wallet holds both LP and trader history.`,
  };
  if (c.includes('curator') || c.includes('allocator') || c.includes('aggregator')) return {
    core: `Deposit ${money(capital)} into a ${n} vault on ${chain} whose underlying you recognise, and keep the vault shares untouched.`,
    second: `Split a second, smaller deposit into a different ${n} vault so the wallet follows more than one strategy the curators run.`,
  };
  if (c.includes('rwa')) return {
    core: `Complete ${n}'s onboarding or KYC if it asks, then mint ${money(capital)} of its yield asset on ${chain} and hold it to term.`,
    second: `Hold the asset past one full distribution date: most RWA points and allowlist records are taken at distribution snapshots.`,
  };
  if (c.includes('basis') || c.includes('leveraged farm')) return {
    core: `Open ${n}'s standard basis or leveraged position with ${money(capital)} on ${chain}, at the lowest leverage it offers.`,
    second: `Check the position's funding and health weekly and top up margin early; a liquidated farm earns nothing and loses the stake.`,
  };
  if (c.includes('prediction')) return {
    core: `Fund ${money(capital)} and take one position in ${n}'s most liquid market, sized so a total loss is acceptable.`,
    second: `Trade a second market in a different category each week; breadth of markets is what prediction platforms record.`,
  };
  if (c.includes('insurance')) return {
    core: `Buy ${money(capital)} of cover from ${n} on ${chain} for a protocol you actually use, and keep the policy to expiry.`,
    second: `Stake a smaller amount into ${n}'s underwriting pool only if you accept its loss terms; underwriting is the side most cover protocols reward.`,
  };
  if (c.includes('yield') || c.includes('stable')) return {
    core: `Deposit ${money(capital)} of USDC into ${n} on ${chain} and keep the yield-bearing receipt in the wallet.`,
    second: `Compound the yield back into the position once a month rather than withdrawing it, so the balance history grows steadily.`,
  };
  return {
    core: `Deposit ${money(capital)} of USDC into ${n} on ${chain} through its own app and keep the position open.`,
    second: `Use one more of ${n}'s own features each week (a second pool, a vote, a referral-free second deposit) so the wallet reads as a user, not a passer-by.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, every figure
 * derived from the protocol's own record. The gate wants 3 to 12 steps of 20 to 600 characters.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const { chain, cost } = cheapestChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { core, second } = playbook(p, capital, chain);
  const action = money(cost);
  const weekly = money(cost * 2);
  const steps = [
    `Set up a fresh wallet for ${p.name} alone, write its seed phrase on paper, and fund it only with what this plan uses. Cost: no fee beyond ${action} for the first transaction on ${chain}. Time: 10 minutes.`,
    `Route the capital to ${chain}, the cheapest chain ${p.name} runs on (about ${action} an action there, against about $8 on Ethereum mainnet): bridge or withdraw ${money(capital + 25)} of USDC to it. Cost: about ${money(cost * 3)} in bridge and gas fees. Time: 20 minutes.`,
    `${core} Cost: ${money(capital)} of capital plus about ${action} in fees. Time: 15 minutes to set up.`,
    `${second} Cost: about ${weekly} in fees. Time: 15 minutes.`,
    `Make one qualifying action a week (a deposit, a swap, a vote or a claim check) so the wallet is active in at least eight separate weeks. Cost: about ${weekly} a week in fees. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days: ${p.name} has run ${age === null ? 'for an unrecorded span' : `for ${age} days`} with no token recorded, and snapshots that decide allocations favour wallets that stayed. Cost: the ${money(capital)} stays in the position. Time: ${hold} days.`,
    `When you finish, claim only from the link on ${p.name}'s own page, never from a message or a search ad, and log the wallet, dates and transactions before you unwind. Cost: nothing to check, and never pay anyone to claim. Time: 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---- The board ----------------------------------------------------------------

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = peerTable(snapshot);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, table);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.peer.multiple,
      peer_count: s.peer.peers,
      peer_scope: s.peer.scope,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap: the peer evidence, shown at the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MODEL.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const table = peerTable(snapshot);
  const peers = [...table.byCategory.values()]
    .filter((s) => s.peers >= MODEL.peer_min_count)
    .sort((a, b) => b.multiple - a.multiple);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    global_multiple: table.global.multiple,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    peers,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, spread, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

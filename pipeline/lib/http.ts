/**
 * Network layer for the pipeline. Every call has a timeout, bounded retries
 * with exponential backoff, and (for RPC) an ordered list of fallback
 * endpoints. Nothing here needs an API key.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getJson<T>(url: string, opts: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", "user-agent": "assay-pipeline" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(600 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const RPC_LIVE = ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org", "https://near.lava.build"];
export const RPC_ARCHIVAL = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];

type RpcEnvelope<T> = { result?: T; error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown } };

export class RpcError extends Error {
  permanent = false;
  constructor(
    message: string,
    public causeName?: string,
  ) {
    super(message);
  }
}

/**
 * Errors that will not get better by retrying. UNKNOWN_EPOCH is deliberately
 * absent: archival providers are load-balanced and a node that lacks an epoch
 * answers this way while its neighbour has it, so it is worth another try.
 */
const PERMANENT = new Set(["UNKNOWN_BLOCK", "UNKNOWN_ACCOUNT", "INVALID_ACCOUNT", "NO_CONTRACT_CODE", "CONTRACT_EXECUTION_ERROR", "PARSE_ERROR"]);

/**
 * Public RPC endpoints rate-limit by IP. All RPC calls in the process share
 * one queue with a minimum gap, so the pipeline stays under the limit instead
 * of being throttled and retrying.
 */
const RPC_MIN_GAP_MS = 230;
let rpcGate: Promise<void> = Promise.resolve();
function rpcSlot(): Promise<void> {
  const slot = rpcGate.then(() => sleep(RPC_MIN_GAP_MS));
  rpcGate = slot;
  return slot;
}

export async function rpc<T>(method: string, params: unknown, opts: { archival?: boolean; retries?: number } = {}): Promise<T> {
  const endpoints = opts.archival ? RPC_ARCHIVAL : RPC_LIVE;
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const endpoint of endpoints) {
      try {
        await rpcSlot();
        const res = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(40_000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "assay", method, params }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
        const body = (await res.json()) as RpcEnvelope<T>;
        if (body.error) {
          const causeName = body.error.cause?.name ?? body.error.name;
          const err = new RpcError(`${method}: ${causeName ?? ""} ${body.error.message ?? JSON.stringify(body.error.data ?? "")}`.trim(), causeName);
          // Only the primary endpoint is trusted to say "this does not exist".
          // A fallback node may simply hold less history.
          if (causeName && PERMANENT.has(causeName) && endpoint === endpoints[0]) {
            err.permanent = true;
            throw err;
          }
          lastErr = err;
          continue;
        }
        if (body.result === undefined) throw new Error(`${method}: empty result from ${endpoint}`);
        return body.result;
      } catch (err) {
        if (err instanceof RpcError && err.permanent) throw err;
        lastErr = err;
      }
    }
    if (attempt < retries) await sleep(800 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Run async jobs with a fixed concurrency; results keep input order. */
export async function pool<I, O>(items: I[], limit: number, job: (item: I, index: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await job(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type BlockHeader = {
  height: number;
  hash: string;
  prev_hash: string;
  epoch_id: string;
  next_epoch_id: string;
  timestamp_nanosec: string;
  total_supply: string;
};
export type Block = { header: BlockHeader; chunks: { balance_burnt: string }[] };

export const getBlock = (blockId: number | string, archival = true) => rpc<Block>("block", { block_id: blockId }, { archival });
export const getFinalBlock = () => rpc<Block>("block", { finality: "final" });

export type ValidatorInfo = {
  account_id: string;
  stake: string;
  num_expected_blocks: number;
  num_produced_blocks: number;
  num_expected_chunks: number;
  num_produced_chunks: number;
  num_expected_endorsements?: number;
  num_produced_endorsements?: number;
};
export type ValidatorsResult = {
  epoch_height: number;
  epoch_start_height: number;
  current_validators: ValidatorInfo[];
  next_validators: { account_id: string; stake: string }[];
  prev_epoch_kickout: { account_id: string; reason: unknown }[];
  validator_reward_paid_prev_epoch?: Record<string, string>;
};

export async function viewAccount(accountId: string, blockId?: number): Promise<{ amount: string; locked: string }> {
  const params = blockId === undefined ? { request_type: "view_account", finality: "final", account_id: accountId } : { request_type: "view_account", block_id: blockId, account_id: accountId };
  return rpc("query", params, { archival: blockId !== undefined });
}

export async function viewCall<T>(accountId: string, method: string, args: object = {}): Promise<T> {
  const res = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(res.result).toString("utf8")) as T;
}

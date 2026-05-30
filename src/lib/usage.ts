import { promises as fs } from "fs";
import path from "path";
import { isSupabaseConfigured, getSupabase } from "./supabase";

// USD per 1M tokens. Cache reads ≈ 0.1× input; cache writes ≈ 1.25× input.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export function computeCost(model: string, u: TurnUsage): number {
  const p = PRICES[model] ?? { in: 3, out: 15 };
  return (
    (u.input * p.in + u.output * p.out + u.cacheRead * p.in * 0.1 + u.cacheCreation * p.in * 1.25) /
    1_000_000
  );
}

export interface UsageEntry extends TurnUsage {
  conversationId: string;
  model: string;
  cost: number;
  createdAt: string;
}

export interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  turns: number;
}

const FILE = path.join(process.cwd(), "data", "usage.json");

async function readLocal(): Promise<UsageEntry[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as UsageEntry[];
  } catch {
    return [];
  }
}

export async function logUsage(entry: UsageEntry): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from("usage_log").insert({
      conversation_id: entry.conversationId,
      model: entry.model,
      input_tokens: entry.input,
      output_tokens: entry.output,
      cache_read_tokens: entry.cacheRead,
      cache_creation_tokens: entry.cacheCreation,
      cost: entry.cost,
    });
    if (error) throw error;
    return;
  }
  const all = await readLocal();
  all.push(entry);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function usageSummary(): Promise<UsageSummary> {
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase()
      .from("usage_log")
      .select("cost,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens");
    if (error) throw error;
    const rows = data ?? [];
    return {
      totalCost: rows.reduce((s, r: any) => s + Number(r.cost ?? 0), 0),
      totalTokens: rows.reduce(
        (s, r: any) =>
          s +
          (r.input_tokens ?? 0) +
          (r.output_tokens ?? 0) +
          (r.cache_read_tokens ?? 0) +
          (r.cache_creation_tokens ?? 0),
        0
      ),
      turns: rows.length,
    };
  }
  const all = await readLocal();
  return {
    totalCost: all.reduce((s, e) => s + e.cost, 0),
    totalTokens: all.reduce((s, e) => s + e.input + e.output + e.cacheRead + e.cacheCreation, 0),
    turns: all.length,
  };
}

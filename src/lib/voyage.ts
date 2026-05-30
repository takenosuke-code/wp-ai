// Voyage AI embeddings client. Stateless: text in → vector out. The vectors are
// stored/searched in Supabase (pgvector); Voyage only does the conversion.
//
// voyage-3.5-lite: cheapest series-3 model, multilingual (handles Japanese),
// 1024-dim output, and the first 200M tokens are free. Cost is a rounding error
// versus generation, so we don't track it.

const MODEL = "voyage-3.5-lite";
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
export const EMBED_DIM = 1024;

export function isVoyageConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

// input_type tunes the embedding: "document" for stored posts, "query" for a
// search request. Matching them improves retrieval quality at no extra cost.
async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (!isVoyageConfigured()) throw new Error("VOYAGE_API_KEY not set");
  if (texts.length === 0) return [];

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export async function embedDocument(text: string): Promise<number[]> {
  return (await embed([text], "document"))[0];
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embed([text], "query"))[0];
}

// What we embed for a post: title carries a lot of the topical signal, so we
// prepend it to the body. Kept in one place so backfill + save stay consistent.
export function postEmbeddingText(title: string, content: string): string {
  return `${title}\n\n${content}`;
}

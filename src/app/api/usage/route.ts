import { usageSummary } from "@/lib/usage";
import { store } from "@/lib/store";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!getSessionUser()) return unauthorized();
  const summary = await usageSummary();
  const blogCount = (await store.list()).length;
  return Response.json({
    ...summary,
    blogCount,
    avgCostPerBlog: blogCount ? summary.totalCost / blogCount : 0,
  });
}

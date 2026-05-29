import { store } from "./store";

// Tool definitions handed to Claude. Custom (client-side) tools: plain JSON schema.
export const tools = [
  {
    name: "list_existing_posts",
    description:
      "List the blog posts that already exist on the site. Call this before proposing or drafting a new post so you can avoid duplicate topics, reuse the site's existing categories and tags, and suggest internal links to related posts. Returns title, category, tags, excerpt, and date for each post.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "save_blog_post",
    description:
      "Publish a finished blog post to the site's collection. Only call this after the user has reviewed and approved the final draft. The post appears in the site collection immediately.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        slug: {
          type: "string",
          description: "URL-friendly slug: lowercase words separated by hyphens.",
        },
        excerpt: {
          type: "string",
          description: "A 1–2 sentence summary used in listings and as the SEO meta description.",
        },
        content: { type: "string", description: "The full post body in Markdown." },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        featured_image_prompt: {
          type: "string",
          description: "A prompt an image model could use to generate the featured image.",
        },
      },
      required: ["title", "slug", "excerpt", "content", "category", "tags", "featured_image_prompt"],
      additionalProperties: false,
    },
  },
];

export interface ToolResult {
  content: string;
  isError: boolean;
}

type Emit = (event: Record<string, unknown>) => void;

export async function runTool(name: string, input: any, emit: Emit): Promise<ToolResult> {
  if (name === "list_existing_posts") {
    const posts = await store.list();
    const summary = posts.map((p) => ({
      title: p.title,
      category: p.category,
      tags: p.tags,
      excerpt: p.excerpt,
      createdAt: p.createdAt,
    }));
    return { content: JSON.stringify(summary), isError: false };
  }

  if (name === "save_blog_post") {
    const post = await store.save({
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt,
      content: input.content,
      category: input.category,
      tags: input.tags ?? [],
      featuredImagePrompt: input.featured_image_prompt,
    });
    // Tell the UI a post was published so it can refresh the collection.
    emit({ type: "blog", blog: post });
    return {
      content: `Saved post "${post.title}" (id ${post.id}). It now appears in the site collection.`,
      isError: false,
    };
  }

  return { content: `Unknown tool: ${name}`, isError: true };
}

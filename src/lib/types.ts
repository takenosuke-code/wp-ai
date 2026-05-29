export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string; // Markdown
  category: string;
  tags: string[];
  featuredImagePrompt: string; // prompt for an image model (image generation is a later seam)
  createdAt: string; // ISO timestamp
}

export type NewBlogPost = Omit<BlogPost, "id" | "createdAt">;

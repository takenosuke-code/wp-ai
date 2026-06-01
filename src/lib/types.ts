export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string; // Markdown
  category: string;
  tags: string[];
  featuredImagePrompt: string; // prompt for an image model (image generation is a later seam)
  featuredImageUrl?: string; // public URL of the uploaded featured image (first image placed in the post)
  postType?: string; // intent/format: how-to | marketing | informational | opinion | news | personal
  createdAt: string; // ISO timestamp
}

export type NewBlogPost = Omit<BlogPost, "id" | "createdAt">;

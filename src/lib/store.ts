import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { BlogPost, NewBlogPost } from "./types";

/**
 * PublishTarget is the seam between the AI and wherever posts actually live.
 * Today it's a local JSON file. Later, swap in a target that writes to Supabase
 * / loop_asia / WordPress without touching the chat or tool code.
 */
export interface PublishTarget {
  list(): Promise<BlogPost[]>;
  save(post: NewBlogPost): Promise<BlogPost>;
}

const DATA_FILE = path.join(process.cwd(), "data", "blogs.json");

class LocalJsonStore implements PublishTarget {
  async list(): Promise<BlogPost[]> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      return JSON.parse(raw) as BlogPost[];
    } catch {
      return [];
    }
  }

  async save(input: NewBlogPost): Promise<BlogPost> {
    const posts = await this.list();
    const post: BlogPost = {
      ...input,
      tags: input.tags ?? [],
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    posts.unshift(post);
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(posts, null, 2), "utf8");
    return post;
  }
}

export const store: PublishTarget = new LocalJsonStore();

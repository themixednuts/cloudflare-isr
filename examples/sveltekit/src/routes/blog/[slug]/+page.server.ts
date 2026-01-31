import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

const posts: Record<string, { title: string; content: string }> = {
  "hello-world": {
    title: "Hello World",
    content: "This is the first blog post. Welcome to ISR with SvelteKit!",
  },
  "getting-started": {
    title: "Getting Started with ISR",
    content:
      "Incremental Static Regeneration lets you cache pages at the edge and revalidate them on a schedule or on-demand.",
  },
};

export const load: PageServerLoad = async ({ params }) => {
  const post = posts[params.slug];
  if (!post) {
    error(404, "Post not found");
  }
  return {
    ...post,
    generatedAt: new Date().toISOString(),
  };
};

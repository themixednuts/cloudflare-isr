import { useParams } from "@solidjs/router";

const posts: Record<string, { title: string; content: string }> = {
  "hello-world": {
    title: "Hello World",
    content: "This is the first blog post. Welcome to ISR with SolidStart!",
  },
  "getting-started": {
    title: "Getting Started with ISR",
    content:
      "Incremental Static Regeneration lets you cache pages at the edge and revalidate them on a schedule or on-demand.",
  },
};

export default function BlogPost() {
  const params = useParams<{ slug: string }>();
  const post = () => posts[params.slug];

  return (
    <div>
      <h1>{post()?.title ?? "Not Found"}</h1>
      <p>{post()?.content ?? "Post not found."}</p>
      <p>Generated at: <code>{new Date().toISOString()}</code></p>
    </div>
  );
}

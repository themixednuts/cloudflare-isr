<script setup lang="ts">
const route = useRoute();
const slug = route.params.slug as string;

const posts: Record<string, { title: string; content: string }> = {
  "hello-world": {
    title: "Hello World",
    content: "This is the first blog post. Welcome to ISR with Nuxt!",
  },
  "getting-started": {
    title: "Getting Started with ISR",
    content:
      "Incremental Static Regeneration lets you cache pages at the edge and revalidate them on a schedule or on-demand.",
  },
};

const post = posts[slug];
const title = post?.title ?? "Not Found";
const content = post?.content ?? "Post not found.";
const generatedAt = new Date().toISOString();
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <p>{{ content }}</p>
    <p>Generated at: <code>{{ generatedAt }}</code></p>
  </div>
</template>

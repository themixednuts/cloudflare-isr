<script>
  let { data } = $props();
</script>

<h1>Nested Override</h1>
<p>This page overrides the layout ISR config (revalidate: 30, tags: nested+override).</p>
<p>Generated at: <code>{data.generatedAt}</code></p>

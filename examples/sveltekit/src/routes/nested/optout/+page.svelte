<script>
  let { data } = $props();
</script>

<h1>Nested Opt-out</h1>
<p>This page opts out of ISR (revalidate: 0) despite the layout setting ISR config.</p>
<p>Generated at: <code>{data.generatedAt}</code></p>

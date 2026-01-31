<script>
  let { data } = $props();
</script>

<h1>ISR SvelteKit Example</h1>
<p>This page is cached with ISR (revalidate every 60s).</p>
<p>Generated at: <code>{data.generatedAt}</code></p>
<p>
  Check the <code>X-ISR-Status</code> response header to see HIT / MISS / STALE.
</p>

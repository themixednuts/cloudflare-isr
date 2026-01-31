<script>
  let { data } = $props();
</script>

<h1>{data.title}</h1>
<p>{data.content}</p>
{#if data.generatedAt}
  <p>Generated at: <code>{data.generatedAt}</code></p>
{/if}

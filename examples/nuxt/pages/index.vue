<script setup lang="ts">
const generatedAt = new Date().toISOString();
</script>

<template>
  <div>
    <h1>ISR Nuxt Example</h1>
    <p>This page is cached with ISR (revalidate every 60s).</p>
    <p>Generated at: <code>{{ generatedAt }}</code></p>
    <p>
      Check the <code>X-ISR-Status</code> response header to see HIT / MISS / STALE.
    </p>
  </div>
</template>

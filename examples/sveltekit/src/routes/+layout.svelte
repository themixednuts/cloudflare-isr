<nav>
  <a href="/">Home</a>
  <a href="/blog/hello-world">Hello World</a>
  <a href="/blog/getting-started">Getting Started</a>
</nav>
<hr />
{@render children()}

<script>
  let { children } = $props();
</script>

export default function Home() {
  return (
    <div>
      <h1>ISR SolidStart Example</h1>
      <p>This page is cached with ISR (revalidate every 60s).</p>
      <p>Generated at: <code>{new Date().toISOString()}</code></p>
      <p>
        Check the <code>X-ISR-Status</code> response header to see HIT / MISS / STALE.
      </p>
    </div>
  );
}

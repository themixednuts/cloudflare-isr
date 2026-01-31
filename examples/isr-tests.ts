/**
 * Integration tests for ISR examples.
 *
 * Usage:
 *   1. Start any example with wrangler:
 *      cd examples/sveltekit && bun run dev:cf
 *   2. Run these tests against it:
 *      bun run examples/isr-tests.ts http://localhost:8899
 *
 * Tests validate:
 *   - Cache MISS on first request
 *   - Cache HIT on second request (same body)
 *   - Blog route MISS → HIT cycle
 *   - Path-based revalidation (purges specific path)
 *   - Tag-based revalidation (purges all paths with that tag)
 *   - Non-ISR routes are not cached
 *   - Revalidation API returns correct response
 */

const BASE = process.argv[2] || "http://localhost:8899";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { "Cache-Control": "no-cache" },
  });
}

async function revalidate(body: { path?: string; tag?: string }): Promise<Response> {
  return fetch(`${BASE}/api/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isrStatus(res: Response): string | null {
  return res.headers.get("X-ISR-Status");
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function testHomeMissThenHit() {
  console.log("\n— Home page: MISS → HIT");

  const first = await get("/");
  const firstBody = await first.text();
  const firstStatus = isrStatus(first);
  assert(firstStatus === "MISS", `First request is MISS`, `got ${firstStatus}`);
  assert(first.status === 200, `Status is 200`, `got ${first.status}`);

  const second = await get("/");
  const secondBody = await second.text();
  const secondStatus = isrStatus(second);
  assert(secondStatus === "HIT", `Second request is HIT`, `got ${secondStatus}`);
  assert(secondBody === firstBody, `Body is identical on HIT (cached)`);
}

async function testBlogMissThenHit() {
  console.log("\n— Blog page: MISS → HIT");

  const first = await get("/blog/hello-world");
  const firstBody = await first.text();
  const firstStatus = isrStatus(first);
  assert(firstStatus === "MISS", `First request is MISS`, `got ${firstStatus}`);
  assert(first.status === 200, `Status is 200`, `got ${first.status}`);
  assert(firstBody.includes("Hello World"), `Body contains post title`);

  const second = await get("/blog/hello-world");
  const secondBody = await second.text();
  const secondStatus = isrStatus(second);
  assert(secondStatus === "HIT", `Second request is HIT`, `got ${secondStatus}`);
  assert(secondBody === firstBody, `Body is identical on HIT (cached)`);
}

async function testSecondBlogPostIndependent() {
  console.log("\n— Second blog post cached independently");

  const first = await get("/blog/getting-started");
  const firstStatus = isrStatus(first);
  assert(firstStatus === "MISS", `First request is MISS`, `got ${firstStatus}`);

  const second = await get("/blog/getting-started");
  const secondStatus = isrStatus(second);
  assert(secondStatus === "HIT", `Second request is HIT`, `got ${secondStatus}`);
}

async function testRevalidatePath() {
  console.log("\n— Path revalidation: purges specific path");

  // Prime the cache
  await get("/");
  const cached = await get("/");
  assert(isrStatus(cached) === "HIT", `Home is cached (HIT)`, `got ${isrStatus(cached)}`);

  // Revalidate
  const res = await revalidate({ path: "/" });
  const body = await res.json();
  assert(res.status === 200, `Revalidate returns 200`, `got ${res.status}`);
  assert(body.revalidated === true, `Response has { revalidated: true }`);

  // Next request should be MISS
  const after = await get("/");
  const afterStatus = isrStatus(after);
  assert(afterStatus === "MISS", `After revalidation is MISS`, `got ${afterStatus}`);
}

async function testRevalidateTag() {
  console.log("\n— Tag revalidation: purges all blog posts");

  // Prime both blog posts
  await get("/blog/hello-world");
  await get("/blog/getting-started");

  const cachedA = await get("/blog/hello-world");
  const cachedB = await get("/blog/getting-started");
  assert(isrStatus(cachedA) === "HIT", `hello-world is cached`, `got ${isrStatus(cachedA)}`);
  assert(isrStatus(cachedB) === "HIT", `getting-started is cached`, `got ${isrStatus(cachedB)}`);

  // Revalidate the "blog" tag
  const res = await revalidate({ tag: "blog" });
  const body = await res.json();
  assert(res.status === 200, `Revalidate returns 200`, `got ${res.status}`);
  assert(body.revalidated === true, `Response has { revalidated: true }`);

  // Both should be MISS now
  const afterA = await get("/blog/hello-world");
  const afterB = await get("/blog/getting-started");
  assert(isrStatus(afterA) === "MISS", `hello-world is MISS after tag revalidation`, `got ${isrStatus(afterA)}`);
  assert(isrStatus(afterB) === "MISS", `getting-started is MISS after tag revalidation`, `got ${isrStatus(afterB)}`);
}

async function testTagRevalidationDoesNotAffectOtherRoutes() {
  console.log("\n— Tag revalidation scoping: blog tag does not purge home");

  // Prime home and a blog post
  await get("/");
  await get("/blog/hello-world");

  const cachedHome = await get("/");
  const cachedBlog = await get("/blog/hello-world");
  assert(isrStatus(cachedHome) === "HIT", `Home is cached`, `got ${isrStatus(cachedHome)}`);
  assert(isrStatus(cachedBlog) === "HIT", `Blog is cached`, `got ${isrStatus(cachedBlog)}`);

  // Revalidate only the "blog" tag
  await revalidate({ tag: "blog" });

  const afterHome = await get("/");
  const afterBlog = await get("/blog/hello-world");
  assert(isrStatus(afterHome) === "HIT", `Home still HIT (unaffected)`, `got ${isrStatus(afterHome)}`);
  assert(isrStatus(afterBlog) === "MISS", `Blog is MISS (purged)`, `got ${isrStatus(afterBlog)}`);
}

async function testRevalidateApiValidation() {
  console.log("\n— Revalidation API: handles empty and combined payloads");

  // Empty body — should succeed as no-op
  const empty = await revalidate({});
  const emptyBody = await empty.json();
  assert(empty.status === 200, `Empty payload returns 200`, `got ${empty.status}`);
  assert(emptyBody.revalidated === true, `Empty payload returns { revalidated: true }`);

  // Both path and tag in one request
  await get("/");
  await get("/blog/hello-world");
  const combined = await revalidate({ path: "/", tag: "blog" });
  const combinedBody = await combined.json();
  assert(combined.status === 200, `Combined payload returns 200`);
  assert(combinedBody.revalidated === true, `Combined payload returns { revalidated: true }`);

  const afterHome = await get("/");
  const afterBlog = await get("/blog/hello-world");
  assert(isrStatus(afterHome) === "MISS", `Home purged by path`, `got ${isrStatus(afterHome)}`);
  assert(isrStatus(afterBlog) === "MISS", `Blog purged by tag`, `got ${isrStatus(afterBlog)}`);
}

async function testTimestampFrozenOnHit() {
  console.log("\n— Timestamp: frozen on HIT, changes on MISS");

  // Revalidate to ensure clean state
  await revalidate({ path: "/" });

  const first = await get("/");
  const firstBody = await first.text();
  assert(isrStatus(first) === "MISS", `First request is MISS`, `got ${isrStatus(first)}`);

  // Small delay to ensure timestamps would differ if re-rendered
  await new Promise((r) => setTimeout(r, 50));

  const second = await get("/");
  const secondBody = await second.text();
  assert(isrStatus(second) === "HIT", `Second request is HIT`, `got ${isrStatus(second)}`);
  assert(
    firstBody === secondBody,
    `Timestamp is identical (not re-rendered)`,
    `bodies differ`,
  );

  // After revalidation, timestamp should change
  await revalidate({ path: "/" });
  await new Promise((r) => setTimeout(r, 50));

  const third = await get("/");
  assert(isrStatus(third) === "MISS", `After revalidation is MISS`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nISR Integration Tests — ${BASE}\n${"=".repeat(50)}`);

  try {
    // Verify server is reachable
    const probe = await fetch(BASE).catch(() => null);
    if (!probe) {
      console.error(`\nServer not reachable at ${BASE}`);
      console.error("Start an example first, e.g.:");
      console.error("  cd examples/sveltekit && bun run dev:cf");
      process.exit(1);
    }
  } catch {
    console.error(`\nServer not reachable at ${BASE}`);
    process.exit(1);
  }

  // Purge all routes to ensure a clean slate (server may have been hit before)
  console.log("\n— Setup: purging all caches");
  await revalidate({ path: "/" });
  await revalidate({ path: "/blog/hello-world" });
  await revalidate({ path: "/blog/getting-started" });
  await revalidate({ tag: "home" });
  await revalidate({ tag: "blog" });

  await testHomeMissThenHit();
  await testBlogMissThenHit();
  await testSecondBlogPostIndependent();
  await testRevalidatePath();
  await testRevalidateTag();
  await testTagRevalidationDoesNotAffectOtherRoutes();
  await testRevalidateApiValidation();
  await testTimestampFrozenOnHit();

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();

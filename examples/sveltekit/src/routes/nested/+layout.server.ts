import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  // Simulate async work (e.g. fetching shared data).
  // This delay means the layout load often finishes AFTER the page load.
  // With the old `locals.isrRouteConfig = ...` pattern, this caused a race
  // condition. With defaults()/set(), order doesn't matter.
  await new Promise((r) => setTimeout(r, 50));

  // Set ISR defaults for all pages under /nested/*.
  // Pages can override with isr.set() — set() always wins for revalidate,
  // and tags are merged from both defaults() and set().
  locals.isr.defaults({ revalidate: 300, tags: ["nested"] });
};

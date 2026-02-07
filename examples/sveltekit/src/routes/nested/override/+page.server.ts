import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  // Override revalidate and add an extra tag.
  // Layout's defaults({ tags: ["nested"] }) still applies — tags merge,
  // so this page ends up with tags: ["nested", "override"].
  locals.isr.set({ revalidate: 30, tags: ["override"] });

  return {
    generatedAt: new Date().toISOString(),
  };
};

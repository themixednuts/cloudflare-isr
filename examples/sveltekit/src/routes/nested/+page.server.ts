import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  // No isr.set() needed — layout defaults apply automatically.
  return {
    generatedAt: new Date().toISOString(),
  };
};

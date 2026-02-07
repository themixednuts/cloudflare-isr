import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  // Opt out of ISR — revalidate: 0 wins over layout defaults.
  locals.isr.set({ revalidate: 0 });

  return {
    generatedAt: new Date().toISOString(),
  };
};

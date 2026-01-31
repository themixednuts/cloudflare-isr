import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  return {
    generatedAt: new Date().toISOString(),
  };
};

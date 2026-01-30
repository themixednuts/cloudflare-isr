/**
 * Test worker entry point.
 *
 * Exports the Durable Object classes so that vitest-pool-workers can
 * instantiate them in the test environment.
 */
export { ISRTagIndexDO } from "./revalidation/tag-index-do.ts";

import { Handle } from '@sveltejs/kit';
import { ISRAdapterOptions } from '../types.ts';
export type { ISRAdapterOptions } from '../types.ts';
/**
 * Create a SvelteKit `Handle` that integrates ISR.
 *
 * @remarks Options are captured on first invocation and reused for all subsequent requests.
 * Changing options after the first request has no effect.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * import { handle as isr } from "cloudflare-isr/sveltekit";
 * export const handle = isr();
 * ```
 */
export declare function handle(options?: ISRAdapterOptions): Handle;

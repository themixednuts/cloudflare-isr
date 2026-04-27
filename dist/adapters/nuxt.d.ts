import { NitroAppPlugin } from 'nitropack';
import { ISRAdapterOptions } from '../types.ts';
export type { ISRAdapterOptions } from '../types.ts';
/**
 * Create a Nuxt/Nitro plugin that integrates ISR.
 *
 * @remarks Options are captured on first invocation and reused for all subsequent requests.
 * Changing options after the first request has no effect.
 *
 * @example
 * ```ts
 * // server/plugins/isr.ts
 * import { handle } from "cloudflare-isr/nuxt";
 * export default handle({ routes: { "/": { revalidate: 60 } } });
 * ```
 */
export declare function handle(options?: ISRAdapterOptions): NitroAppPlugin;

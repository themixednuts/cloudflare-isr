import { RouteConfig } from './types.ts';
export interface RouteMatch {
    pattern: string;
    config: RouteConfig;
}
/**
 * Match a pathname against configured route patterns.
 *
 * Supported pattern syntax:
 * - Exact:        `/about`
 * - Param:        `/blog/:slug` or `/blog/[slug]`
 * - Catch-all:    `/docs/[...rest]`
 * - Wildcard:     `/products/*`
 */
export declare function matchRoute(pathname: string, routes: Readonly<Record<string, RouteConfig>>): RouteMatch | null;

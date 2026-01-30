import type { RouteConfig } from "./types.ts";

export interface RouteMatch {
  pattern: string;
  config: RouteConfig;
}

interface CompiledRoute {
  pattern: string;
  config: RouteConfig;
  regex: RegExp;
}

const compiledRoutesCache = new WeakMap<object, CompiledRoute[]>();

function getCompiledRoutes(
  routes: Record<string, RouteConfig>,
): CompiledRoute[] {
  const cached = compiledRoutesCache.get(routes);
  if (cached) return cached;
  const compiled = Object.entries(routes).map(([pattern, config]) => ({
    pattern,
    config,
    regex: patternToRegex(pattern),
  }));
  compiledRoutesCache.set(routes, compiled);
  return compiled;
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
export function matchRoute(
  pathname: string,
  routes: Record<string, RouteConfig>,
): RouteMatch | null {
  for (const { pattern, config, regex } of getCompiledRoutes(routes)) {
    if (pattern === pathname) {
      return { pattern, config };
    }

    if (regex.test(pathname)) {
      return { pattern, config };
    }
  }

  return null;
}

function patternToRegex(pattern: string): RegExp {
  let result = "";
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === "[" && pattern.substring(i).startsWith("[...")) {
      const closeIdx = pattern.indexOf("]", i);
      if (closeIdx !== -1) {
        result += "(.+)";
        i = closeIdx + 1;
        continue;
      }
    }

    if (pattern[i] === "[") {
      const closeIdx = pattern.indexOf("]", i);
      if (closeIdx !== -1) {
        result += "([^/]+)";
        i = closeIdx + 1;
        continue;
      }
    }

    if (pattern[i] === ":") {
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "/") {
        j++;
      }
      if (j > i + 1) {
        result += "([^/]+)";
        i = j;
        continue;
      }
    }

    if (pattern[i] === "*" && i === pattern.length - 1) {
      result += "(.*)";
      i++;
      continue;
    }

    const ch = pattern[i]!;
    if ("\\^$.|?+(){}".includes(ch)) {
      result += "\\" + ch;
    } else {
      result += ch;
    }
    i++;
  }

  return new RegExp("^" + result + "$");
}

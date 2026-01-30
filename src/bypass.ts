/**
 * Detects whether a request should bypass ISR caching (e.g. draft mode).
 *
 * Checks the `x-isr-bypass` header and the `__isr_bypass` cookie
 * against the configured bypass token.
 *
 * @param request  - The incoming Request object.
 * @param bypassToken - The secret token to compare against. If not provided, always returns false.
 * @returns `true` if the request carries a valid bypass token.
 */
export function isBypass(request: Request, bypassToken?: string): boolean {
  if (!bypassToken) {
    return false;
  }

  const headerValue = request.headers.get("x-isr-bypass");
  if (headerValue && safeEqual(headerValue.trim(), bypassToken)) {
    return true;
  }

  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookieValue = getCookieValue(cookieHeader, "__isr_bypass");
    if (cookieValue && safeEqual(cookieValue, bypassToken)) {
      return true;
    }
  }

  return false;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(name + "=")) continue;
    const rawValue = trimmed.slice(name.length + 1);
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

/**
 * URL Builder Utility — KeiAI
 *
 * Normalizes base URL + endpoint construction so that callers may include
 * or omit the endpoint path in the base URL and get the same result.
 *
 * Example:
 *   buildUrl("https://api.openai.com/v1", "/chat/completions")
 *   buildUrl("https://api.openai.com/v1/chat/completions", "/chat/completions")
 *   // both → "https://api.openai.com/v1/chat/completions"
 */

/**
 * Build an API URL from a base URL and an endpoint path.
 *
 * Strips trailing slashes from `baseUrl`, then checks whether it already
 * ends with `endpoint`. If so, returns the base as-is; otherwise appends.
 */
export function buildUrl(baseUrl: string, endpoint: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    if (base.endsWith(normalizedEndpoint)) {
        return base;
    }

    return `${base}${normalizedEndpoint}`;
}

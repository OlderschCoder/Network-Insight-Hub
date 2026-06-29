/**
 * Wrapper around `fetch` that injects the stored bearer token. Single source of
 * truth for authenticated requests made outside the generated API client —
 * file downloads, Zendesk timeline pulls, and other raw `fetch` calls — so the
 * `localStorage` token lookup and `Authorization` header stay consistent
 * everywhere instead of being inlined per call site.
 */
export function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

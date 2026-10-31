/** Allocate a coding turn from the current request, never from historical chat. */
export function isFredCodingRequest(text: string, role: string | null | undefined): boolean {
  if (role !== "cio") return false;
  return /\bdevelop_website\b/i.test(text) ||
    (/\b(fix|implement|modify|change|improve|adjust|code|repair|update)\b/i.test(text) &&
      /\b(website|source|code|page|interface|ui|campus map|health calculation)\b/i.test(text));
}

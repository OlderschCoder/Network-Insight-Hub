import { FRED_APPLICATION_PAGES, findFredApplicationPages, renderFredApplicationPage } from "./fred_app_catalog";

/** Only an internal pathname is accepted; never send URL queries or page HTML to AI. */
export function normalizeFredPagePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (!/^\/(?!\/)[a-zA-Z0-9/_~.%:-]*$/.test(path) || path.includes("..")) return null;
  return path;
}

export function buildFredPageContext(value: unknown): string {
  const path = normalizeFredPagePath(value);
  const pages = path ? findFredApplicationPages(path).filter(page =>
    page.routes.some(route => new RegExp(`^${route.replace(/:[^/]+/g, "[^/]+")}/?$`).test(path)),
  ) : [];
  const directory = FRED_APPLICATION_PAGES.map(page =>
    `- ${page.name}: ${page.routes.join(", ")} — ${page.purpose} Access: ${page.access}`,
  ).join("\n");
  return `# Site navigation and current page
This is release-owned product documentation, not live record data or permission to act.
${path ? `User's current page: ${JSON.stringify(path)}` : "No recognized current page was supplied."}
${pages.length ? pages.map(renderFredApplicationPage).join("\n\n") : "Use get_application_guidance to resolve the user's destination."}
Interpret "this page" and "this record" using the current path. Fetch current record data through the appropriate authorized tools; a pathname does not grant access and does not supply field values. If a record cannot be read, explain precisely what is missing. Never invent its contents.
For information entry, identify the destination and missing required fields, use the existing approved action tool and its confirmation rules, and link the saved record after a successful result. If no action tool exists, prepare a usable draft and link the exact form. Never claim a draft was saved or treat navigation as authorization. Do not substitute memory storage for updating the requested record.
Use get_application_guidance for detailed workflows elsewhere on the site. Link internal pages with Markdown; never invent record IDs or substitute a route template for an actual record.
Site directory:
${directory}`;
}

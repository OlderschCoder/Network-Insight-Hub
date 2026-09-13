import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FRED_APPLICATION_PAGES,
  findFredApplicationPages,
  renderFredApplicationPage,
} from "./fred_app_catalog";

describe("Fred application capability catalog", () => {
  it("documents every frontend route", () => {
    const appSource = readFileSync(
      new URL("../../../it-reporting/src/App.tsx", import.meta.url),
      "utf8",
    );
    const frontendRoutes = Array.from(
      appSource.matchAll(/\bpath="([^"]+)"/g),
      (match) => match[1],
    );
    const catalogRoutes = new Set(
      FRED_APPLICATION_PAGES.flatMap((page) => page.routes),
    );

    expect(frontendRoutes.length).toBeGreaterThan(0);
    expect(frontendRoutes.filter((route) => !catalogRoutes.has(route))).toEqual(
      [],
    );
  });

  it("has no duplicate route ownership and describes every page function", () => {
    const routes = FRED_APPLICATION_PAGES.flatMap((page) => page.routes);
    expect(new Set(routes).size).toBe(routes.length);

    for (const page of FRED_APPLICATION_PAGES) {
      expect(page.functions.length).toBeGreaterThan(0);
      expect(page.fredGuides.length).toBeGreaterThan(0);
      expect(renderFredApplicationPage(page)).toContain("Fred can perform:");
      expect(renderFredApplicationPage(page)).toContain("Fred must guide:");
    }
  });

  it("resolves concrete detail URLs against parameterized routes", () => {
    expect(
      findFredApplicationPages("/risks/42/edit").map((page) => page.name),
    ).toEqual(["Risks & Issues"]);
    expect(
      findFredApplicationPages("/network/buildings/Hobble").map(
        (page) => page.name,
      ),
    ).toEqual(["Buildings"]);
  });

  it("understands natural application-guidance questions", () => {
    expect(
      findFredApplicationPages("How do I create a risk?").map(
        (page) => page.name,
      ),
    ).toContain("Risks & Issues");
    expect(
      findFredApplicationPages("Where is password reset activity?").map(
        (page) => page.name,
      ),
    ).toContain("Student Password Reset Activity");
  });

  it("documents Fred's guarded student password-recovery boundary", () => {
    const [kiosk] = findFredApplicationPages("/online-kiosk");
    expect(kiosk.fredDirect.join(" ")).toContain("ten-minute single-use");
    expect(kiosk.fredDirect.join(" ")).toContain("supervised draft");
    expect(kiosk.fredGuides.join(" ")).toContain(
      "does not re-enable an administratively disabled",
    );
  });
});

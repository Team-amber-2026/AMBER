import { convertRewrites } from "@vercel/routing-utils";
import { describe, expect, it } from "vitest";
import config from "./vercel.json";

// Use Vercel's compiler: its strict trailing-slash matching differs from a
// hand-written approximation of the rewrite patterns.
const routes = convertRewrites(config.rewrites);

function destinations(path: string) {
  return routes.flatMap((route) => {
    if (!("src" in route) || typeof route.dest !== "string") return [];
    const pattern = new RegExp(route.src);
    return pattern.test(path) ? [path.replace(pattern, route.dest)] : [];
  });
}

describe("Vercel API proxy routing", () => {
  it.each([
    "auth/csrf", "auth/user", "auth/register", "auth/login", "auth/logout",
    "expenses", "expenses/1", "summary/monthly",
  ])("proxies /api/%s/ with its trailing slash intact", (path) => {
    expect(destinations(`/api/${path}/`)).toEqual([
      `https://amber-api-usdz.onrender.com/api/${path}/`,
    ]);
    expect(destinations(`/api/${path}`)).toEqual([
      `https://amber-api-usdz.onrender.com/api/${path}/`,
    ]);
  });

  it.each(["/", "/login", "/register", "/home", "/expenses/1", "/receipts/new"])(
    "keeps the SPA fallback for %s",
    (path) => expect(destinations(path)).toEqual(["/index.html"]),
  );

  it("never sends an unknown API path to the SPA", () => {
    expect(destinations("/api/unknown/")).toEqual([
      "https://amber-api-usdz.onrender.com/api/unknown/",
    ]);
    expect(destinations("/api/unknown//")).not.toContain("/index.html");
  });
});

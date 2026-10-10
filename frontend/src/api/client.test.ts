import { afterEach, describe, expect, it, vi } from "vitest";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadClient(production: boolean, baseUrl?: string) {
  vi.stubEnv("PROD", production);
  vi.stubEnv("VITE_API_BASE_URL", baseUrl);
  vi.stubGlobal("document", { cookie: "" });
  return (await import("./client")).default;
}

describe("API connection", () => {
  it.each(["/auth/user/", "/summary/monthly/", "/auth/csrf/"])(
    "rejects an HTML page returned with status 200 for %s",
    async (url) => {
      const client = await loadClient(true);
      client.defaults.adapter = async (config) => ({
        config,
        data: "<!doctype html><html><body><div id=\"root\"></div></body></html>",
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
      });

      await expect(client.get(url)).rejects.toMatchObject({ code: "ERR_BAD_RESPONSE" });
    },
  );

  it("does not submit a mutation when the CSRF endpoint returns HTML", async () => {
    const client = await loadClient(true);
    const requests: string[] = [];
    client.defaults.adapter = async (config) => {
      requests.push(config.url!);
      return { config, data: "<!doctype html><html></html>", status: 200, statusText: "OK", headers: {} };
    };

    await expect(client.post("/expenses/", {})).rejects.toMatchObject({ code: "ERR_BAD_RESPONSE" });
    expect(requests).toEqual(["/auth/csrf/"]);
  });

  it("accepts JSON responses and empty 204 responses", async () => {
    const client = await loadClient(true);
    client.defaults.adapter = async (config) => ({
      config,
      data: config.method === "get" ? '{"grand_total":1200}' : "",
      status: config.method === "get" ? 200 : 204,
      statusText: "OK",
      headers: { "content-type": "application/json" },
    });

    expect((await client.get("/summary/monthly/")).data).toEqual({ grand_total: 1200 });
    document.cookie = "csrftoken=test-token";
    await expect(client.delete("/expenses/1/")).resolves.toMatchObject({ status: 204 });
  });

  it("keeps production requests same-origin even with the previous Render URL", async () => {
    const client = await loadClient(true, "https://amber-api-usdz.onrender.com/api");
    expect(client.getUri({ url: "/auth/user/" })).toBe("/api/auth/user/");
    expect(client.defaults.withCredentials).toBe(true);
    expect(client.defaults.xsrfCookieName).toBe("csrftoken");
    expect(client.defaults.xsrfHeaderName).toBe("X-CSRFToken");
  });

  it.each([undefined, "", "   "])("defaults local development to Django (%s)", async (value) => {
    const client = await loadClient(false, value);
    expect(client.getUri({ url: "/auth/user/" })).toBe("http://localhost:8000/api/auth/user/");
  });

  it("supports a local development override", async () => {
    const client = await loadClient(false, " http://127.0.0.1:8000/api ");
    expect(client.getUri({ url: "/auth/user/" })).toBe("http://127.0.0.1:8000/api/auth/user/");
  });

  it("obtains CSRF through the proxy, then uses the rotated cookie after login", async () => {
    const client = await loadClient(true);
    const requests: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
      requests.push(config);
      return {
        config,
        data: config.url === "/auth/csrf/" ? { csrfToken: "initial-token" } : {},
        status: 200,
        statusText: "OK",
        headers: {},
      };
    };
    client.defaults.adapter = adapter;

    await client.post("/auth/register/", {});
    expect(requests.map((request) => client.getUri(request))).toEqual([
      "/api/auth/csrf/", "/api/auth/register/",
    ]);
    expect(requests[1].headers.get("X-CSRFToken")).toBe("initial-token");

    document.cookie = "csrftoken=before-login";
    await client.post("/auth/login/", {});
    document.cookie = "csrftoken=rotated-token";
    await client.post("/expenses/", {});
    await client.post("/auth/logout/");
    expect(requests.slice(2).map((request) => request.headers.get("X-CSRFToken"))).toEqual([
      "before-login", "rotated-token", "rotated-token",
    ]);
  });
});

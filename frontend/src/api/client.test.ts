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

  it.each([
    ["post", "/auth/register/"],
    ["post", "/expenses/"],
    ["put", "/expenses/1/"],
    ["patch", "/expenses/1/"],
    ["delete", "/expenses/1/"],
  ])("uses the current cookie for %s %s", async (method, url) => {
    const client = await loadClient(true);
    const sentTokens: string[] = [];
    client.defaults.adapter = async (config) => {
      sentTokens.push(config.headers.get("X-CSRFToken") as string);
      return { config, data: "", status: 204, statusText: "No Content", headers: {} };
    };

    document.cookie = "csrftoken=register-token";
    await client.request({ method, url, data: {} });
    document.cookie = "csrftoken=expense-token";
    await client.request({ method, url, data: {} });

    expect(sentTokens).toEqual(["register-token", "expense-token"]);
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

  it("fetches a fresh token before each unsafe request when the cookie is unavailable", async () => {
    const client = await loadClient(true);
    const sentTokens: string[] = [];
    let csrfFetches = 0;
    client.defaults.adapter = async (config) => {
      if (config.url === "/auth/csrf/") {
        csrfFetches += 1;
        return {
          config,
          data: { csrfToken: `token-${csrfFetches}` },
          status: 200,
          statusText: "OK",
          headers: {},
        };
      }

      sentTokens.push(config.headers.get("X-CSRFToken") as string);
      return { config, data: "", status: 204, statusText: "No Content", headers: {} };
    };

    await client.post("/auth/login/", {});
    await client.post("/auth/logout/", {});

    expect(csrfFetches).toBe(2);
    expect(sentTokens).toEqual(["token-1", "token-2"]);
  });

  it("shares concurrent CSRF fetches and retries after a failed fetch", async () => {
    const client = await loadClient(true);
    let csrfFetches = 0;
    client.defaults.adapter = async (config) => {
      if (config.url === "/auth/csrf/") {
        csrfFetches += 1;
        if (csrfFetches === 1) {
          throw new Error("CSRF fetch failed");
        }

        await Promise.resolve();
        return {
          config,
          data: { csrfToken: "current-token" },
          status: 200,
          statusText: "OK",
          headers: {},
        };
      }

      return { config, data: "", status: 204, statusText: "No Content", headers: {} };
    };

    await expect(Promise.all([
      client.post("/auth/logout/", {}),
      client.post("/auth/logout/", {}),
    ])).rejects.toThrow("CSRF fetch failed");
    await client.post("/auth/logout/", {});

    expect(csrfFetches).toBe(2);
  });

  it("fetches a current token again after a failed login", async () => {
    const client = await loadClient(true);
    const sentTokens: string[] = [];
    let csrfFetches = 0;
    client.defaults.adapter = async (config) => {
      if (config.url === "/auth/csrf/") {
        csrfFetches += 1;
        return {
          config,
          data: { csrfToken: `token-${csrfFetches}` },
          status: 200,
          statusText: "OK",
          headers: {},
        };
      }

      sentTokens.push(config.headers.get("X-CSRFToken") as string);
      if (config.url === "/auth/login/") {
        throw new Error("Invalid credentials");
      }

      return { config, data: "", status: 204, statusText: "No Content", headers: {} };
    };

    await expect(client.post("/auth/login/", {})).rejects.toThrow("Invalid credentials");
    await client.post("/auth/logout/", {});

    expect(csrfFetches).toBe(2);
    expect(sentTokens).toEqual(["token-1", "token-2"]);
  });
});

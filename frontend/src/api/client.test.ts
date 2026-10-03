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

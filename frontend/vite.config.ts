import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "amber-lan-development",
      apply: "serve",
      config({ server }, { isPreview }) {
        if (!isPreview && (server?.host === true || server?.host === "0.0.0.0")) {
          // Vite reloads the page after an HMR disconnect, losing in-memory camera captures.
          return { server: { hmr: false, ws: false } };
        }
      },
      configureServer({ config, httpServer }) {
        if (config.server.ws === false) {
          // The Vite client still requests upgrades. Close them before a reload
          // can reset a socket left open by the HTTP-only API proxy.
          httpServer?.on("upgrade", (
            request: { headers: { "sec-websocket-protocol"?: string } },
            socket: { destroy(): void },
          ) => {
            const protocol = request.headers["sec-websocket-protocol"];
            if (protocol === "vite-hmr" || protocol === "vite-ping") {
              socket.destroy();
            }
          });
        }
      },
    },
  ],
  server: {
    host: "localhost",
    port: 3000,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => {
  const isServer = mode === "server";

  const plugins = [react()];
  if (!isServer) {
    plugins.push(cloudflare({ inspectorPort: 9230 }));
  }

  return {
    plugins,
    build: isServer
      ? {
          ssr: "src/server.ts",
          outDir: "dist/mcp_client",
          rollupOptions: {
            input: "src/server.ts",
            output: { entryFileNames: "server.js" },
            external: ["partyserver"],
          },
        }
      : {
          outDir: "dist",
          emptyOutDir: true,
          rollupOptions: {
            input: "index.html",
          },
        },
  };
});

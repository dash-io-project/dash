import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: resolve(root, "../.."),
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
  resolve: {
    tsconfigPaths: true,
  },
  // Keep native drivers out of the bundle so each one finds its own files.
  ssr: {
    external: ["@sap/hana-client", "ibm_db"],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
    nitro({
      // Close database clients on SIGTERM so the process exits after the listener stops.
      plugins: ["./src/server/plugins/shutdown.ts"],
      // Leave ibm_db external. A bundle cannot find odbc_bindings.node.
      rollupConfig: {
        external: ["ibm_db"],
      },
      // Copy the SAP HANA driver and its native binary into the server output.
      traceDeps: ["@sap/hana-client"],
    }),
  ],
});

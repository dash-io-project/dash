import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [react(), tailwindcss(), {
    name: "dash-mcp-html",
    generateBundle(_options, bundle) {
      const script = Object.values(bundle).filter((entry) => entry.type === "chunk").map((entry) => entry.code).join("\n");
      const css = Object.values(bundle).flatMap((entry) => entry.type === "asset" && entry.fileName.endsWith(".css") ? [entry.source] : []).join("\n");
      for (const name of Object.keys(bundle)) delete bundle[name];
      this.emitFile({ type: "asset", fileName: "view.html", source: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dash</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script type="module">${script.replaceAll("</script", "<\\/script")}</script></body></html>` });
    },
  }],
  build: {
    outDir: ".mcp-app", emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: "src/mcp-app/main.tsx", formats: ["es"], fileName: "view" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

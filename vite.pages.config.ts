import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static, client-only build of the studio for GitHub Pages. The studio keeps all
// music in the browser, so it needs no server runtime. PAGES_BASE is the
// repository sub-path that Pages serves the site from (for example /Kiln/).
export default defineConfig({
  root: fileURLToPath(new URL("./pages", import.meta.url)),
  base: process.env.PAGES_BASE ?? "/Kiln/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-pages", import.meta.url)),
    emptyOutDir: true,
  },
  preview: { host: "127.0.0.1", port: 8082, strictPort: true },
  plugins: [tailwindcss(), viteReact()],
});

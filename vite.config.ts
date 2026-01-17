import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

const vendorChunks: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom"],
  "vendor-router": ["@tanstack/react-router"],
  "vendor-ui": ["class-variance-authority", "clsx", "tailwind-merge"],
  "vendor-charts": ["recharts"],
  "vendor-table": ["@tanstack/react-table"],
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname!, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname!, "index.html"),
        "main-window": resolve(import.meta.dirname!, "main-window.html"),
      },
      output: {
        manualChunks(id) {
          for (const [chunk, deps] of Object.entries(vendorChunks)) {
            if (deps.some((dep) => id.includes(`node_modules/${dep}/`))) {
              return chunk;
            }
          }
        },
      },
    },
    sourcemap: !!process.env.VITE_SENTRY_SOURCEMAPS_ENABLED,
  },
});

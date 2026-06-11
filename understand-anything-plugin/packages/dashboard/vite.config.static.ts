import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Static single-file export config (see scripts/build-static.mjs).
//
// Produces exactly one JS chunk and one CSS file in dist-static-build/,
// which the post-build script inlines into a single self-contained HTML
// file openable via file:// — no module-script imports of separate chunks,
// no runtime fetches. Demo mode bypasses the dev server's token gate.
export default defineConfig({
  base: "./",

  // Don't copy public/ — the sample graph and favicons are not needed;
  // the post-build script inlines the favicon as a data URI.
  publicDir: false,

  resolve: {
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/dist/schema.js"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/dist/search.js"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/dist/types.js"),
    },
  },

  define: {
    "import.meta.env.VITE_DEMO_MODE": JSON.stringify("true"),
  },

  build: {
    outDir: "dist-static-build",
    cssCodeSplit: false,
    // ELK alone is ~1.4 MB minified; the warning is expected for a
    // deliberately single-chunk build.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },

  plugins: [react(), tailwindcss()],
});

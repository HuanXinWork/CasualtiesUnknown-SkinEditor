import { defineConfig } from "vite";

// 与 src-tauri/tauri.conf.json 中 frontendDist (../web/dist) 与 devUrl (http://localhost:5173) 对应
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/inspect/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/recall": "http://127.0.0.1:7811",
      "/commit": "http://127.0.0.1:7811",
      "/carrier": "http://127.0.0.1:7811",
      "/graph": "http://127.0.0.1:7811",
      "/inspect/agents": "http://127.0.0.1:7811",
      "/inspect/memories": "http://127.0.0.1:7811",
      "/inspect/graph": "http://127.0.0.1:7811",
      "/inspect/experiences": "http://127.0.0.1:7811",
      "/health": "http://127.0.0.1:7811",
      "/patterns": "http://127.0.0.1:7811",
      "/skills": "http://127.0.0.1:7811",
      "/report": "http://127.0.0.1:7811",
    },
  },
});

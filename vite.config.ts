import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Pre-bundle every UI library at startup. Otherwise Vite finds radix-ui on the first dialog
  // import, re-bundles mid-session, and the page ends up with two copies of React.
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-dev-runtime", "radix-ui", "@tanstack/react-table"] },
});

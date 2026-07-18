import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Honor a harness/host-assigned port (e.g. Claude Code preview autoPort);
    // falls back to Vite's default 5173 when unset.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
});

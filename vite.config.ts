import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Allow Tailscale Serve / MagicDNS hosts (*.ts.net) and LAN IPs
      allowedHosts: true,
      // Proxy AniList to avoid CORS when opening the app via Tailscale IP / non-localhost
      proxy: {
        '/api/anilist': {
          target: 'https://graphql.anilist.co',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api\/anilist/, '') || '/',
        },
      },
    },
  };
});

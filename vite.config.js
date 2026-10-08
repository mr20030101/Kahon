import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const page = (file) => fileURLToPath(new URL(file, import.meta.url));

// Publishes the app's version at /version.json, so an open tab can tell a newer release has
// been deployed (src/components/UpdateBanner.jsx). Written into every build; the dev server
// answers it live from package.json, so bumping the version there shows the prompt too.
function versionFile() {
  const read = () => JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  const body = () => JSON.stringify({ version: read() });

  return {
    name: 'version-file',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body() });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  build: {
    rollupOptions: {
      // viewer.html is the sandboxed file preview page (src/viewer, FileViewer.jsx).
      input: { main: page('./index.html'), viewer: page('./viewer.html') },
    },
  },
  server: {
    // The preview iframe is sandboxed without allow-same-origin, so its script
    // requests come from origin "null" and need CORS. Same as vercel.json in production.
    cors: { origin: [/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, 'null'] },
  },
});

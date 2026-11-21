import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  worker: { format: 'es' },
  build: {
    // The only chunk above 500 kB is three.js itself (a single library, already isolated below).
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        // Vendors in their own chunks: they download in parallel with the app and stay cached across deploys
        // (a change in the app no longer invalidates ~600 kB of three.js).
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/, priority: 20 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});

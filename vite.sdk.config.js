import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    outDir: 'dist-sdk',
    lib: {
      entry: path.resolve(__dirname, 'src/services/passportClient.js'),
      name: 'AXiMPassportSDK',
      fileName: (format) => `passport-sdk.${format}.js`,
    },
    rollupOptions: {
      // Ensure we don't bundle dependencies that are external to the SDK, though passportClient mainly relies on native fetch.
      external: [],
      output: {
        globals: {},
      },
    },
    emptyOutDir: true,
  },
});

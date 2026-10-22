import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    outDir: 'dist-sdk',
    lib: {
      entry: path.resolve(__dirname, 'src/sdk.js'),
      name: 'AXiMPassportSDK',
      fileName: (format) => `passport-sdk.${format}.js`,
    },
    rollupOptions: {
      // Ensure we don't bundle dependencies that are external to the SDK
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        },
      },
    },
    emptyOutDir: true,
  },
});

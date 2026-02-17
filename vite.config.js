import { defineConfig } from 'vite';

export default defineConfig({
    root: 'src',
    base: './', // Use relative paths for Tauri
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});

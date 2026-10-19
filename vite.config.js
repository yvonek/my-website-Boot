var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    build: {
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    if (!id.includes('node_modules'))
                        return undefined;
                    if (id.includes('@fluentui'))
                        return 'fluent';
                    if (id.includes('framer-motion'))
                        return 'motion';
                    if (id.includes('react'))
                        return 'react';
                    return undefined;
                },
            },
        },
    },
    server: {
        host: true,
        allowedHosts: true,
        strictPort: false,
        proxy: {
            '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        globals: true,
        exclude: __spreadArray(__spreadArray([], configDefaults.exclude, true), ['backend/tests/**'], false),
    },
});

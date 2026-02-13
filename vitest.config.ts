import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 30000,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
  },
});


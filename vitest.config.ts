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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'node_modules/**',
        'src/**/*.d.ts',
        'src/database/migrations.ts',
      ],
      thresholds: {
        statements: 22,
        branches: 20,
        functions: 30,
        lines: 22,
      },
    },
  },
});

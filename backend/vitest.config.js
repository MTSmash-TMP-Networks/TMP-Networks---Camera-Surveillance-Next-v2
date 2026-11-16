import { configDefaults, defineConfig } from 'vitest/config';

// The Node built-in test runner owns test-node/*.test.mjs. Loading those files
// in Vitest reports false "No test suite found" failures despite passing tests.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,
    exclude: [...configDefaults.exclude, 'test-node/**', 'test/**/*.test.mjs'],
  },
});

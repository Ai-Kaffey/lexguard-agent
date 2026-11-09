import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 串行执行测试文件，规避部分 Windows 沙箱下临时目录并发写的 EPERM
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['server/core/**', 'server/agent/**', 'server/providers/**'],
    },
  },
});

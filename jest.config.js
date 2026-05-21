export default {
  testEnvironment: 'jest-environment-jsdom',
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!three)',
  ],
  moduleNameMapper: {
    '\\.(css|less)$': '<rootDir>/__tests__/styleMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/__tests__/setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.js'],

  // 覆盖率配置（npm run test:coverage 时启用）
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main.js',          // 入口文件，UI 协调难测
    '!src/rendering/**',      // Canvas 渲染层，需要 DOM mock
    '!src/ui/**',             // UI 组件层，需要 DOM mock
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'html', 'lcov'],
};

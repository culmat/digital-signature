module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests/unit', '<rootDir>/tests/e2e'],
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/unit/**/*.spec.js',
    '<rootDir>/src/**/__tests__/**/*.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/tests/e2e/',
    '<rootDir>/playwright-report/',
    '<rootDir>/test-results/',
    '<rootDir>/.forge/',
    '<rootDir>/docs/'
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/node_modules/'
  ],
  transformIgnorePatterns: [
    '/node_modules/'
  ]
};

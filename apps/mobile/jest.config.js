/** Jest for the mobile app: jest-expo's React Native preset, the workspace packages transformed. */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
  // The first screen a suite renders loads the router, the player and the catalogs; CI runners
  // take longer than 5 s for that.
  testTimeout: 30_000,
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-track-player|@renaissance/.*|@tanstack/.*|i18next|react-i18next|zod))',
  ],
  collectCoverageFrom: ['src/lib/**/*.ts', 'src/components/**/*.tsx', '!src/**/*.test.*'],
  coverageReporters: ['text-summary'],
  coverageThreshold: { global: { statements: 70, branches: 55, functions: 68, lines: 73 } },
};

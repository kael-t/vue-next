const lernaJson = require('./lerna.json')

module.exports = {
  preset: 'ts-jest',
  globals: {
    __DEV__: true,
    __TEST__: true,
    __VERSION__: lernaJson.version,
    __BROWSER__: false,
    __RUNTIME_COMPILE__: true,
    __FEATURE_OPTIONS__: true,
    __FEATURE_SUSPENSE__: true
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['html', 'lcov', 'text'],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/template-explorer/**',
    '!packages/runtime-test/src/utils/**'
  ],
  watchPathIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^@vue/(.*?)$': '<rootDir>/packages/$1/src'
  },
  rootDir: __dirname,
  // 可以修改下面这里的匹配字符串, 在看源码时每次只调试你在看的部分的测试代码
  testMatch: ['<rootDir>/packages/**/__tests__/**/*spec.[jt]s?(x)']
}

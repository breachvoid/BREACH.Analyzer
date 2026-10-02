/**
 * Direct Vitest Test Suite Runner
 * Transpiles and executes src/utils/audioAnalysis.test.ts in a complete Vitest-compatible sandbox.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');
const assert = require('assert');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let currentSuite = '';

function describe(name, fn) {
  currentSuite = name;
  console.log(`\n\x1b[36m● ${name}\x1b[0m`);
  fn();
}

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  \x1b[31m✗ ${name}\x1b[0m\n    ${err.message}`);
    throw err;
  }
}

const expect = (actual) => ({
  toBe: (expected) => {
    assert.strictEqual(actual, expected, `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
  },
  toEqual: (expected) => {
    assert.deepStrictEqual(actual, expected, `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  },
  toBeGreaterThan: (expected) => {
    assert.ok(actual > expected, `Expected ${actual} > ${expected}`);
  },
  toBeLessThan: (expected) => {
    assert.ok(actual < expected, `Expected ${actual} < ${expected}`);
  },
  toBeGreaterThanOrEqual: (expected) => {
    assert.ok(actual >= expected, `Expected ${actual} >= ${expected}`);
  },
  toBeLessThanOrEqual: (expected) => {
    assert.ok(actual <= expected, `Expected ${actual} <= ${expected}`);
  },
  toBeTruthy: () => {
    assert.ok(!!actual, `Expected truthy value, got ${actual}`);
  },
  toBeFalsy: () => {
    assert.ok(!actual, `Expected falsy value, got ${actual}`);
  },
  toBeDefined: () => {
    assert.ok(actual !== undefined && actual !== null, `Expected value to be defined`);
  },
  toBeUndefined: () => {
    assert.strictEqual(actual, undefined, `Expected value to be undefined, got ${actual}`);
  }
});

// 1. Compile audioAnalysis.ts
const analysisSrc = fs.readFileSync(path.join(__dirname, '../src/utils/audioAnalysis.ts'), 'utf8');
const compiledAnalysis = ts.transpileModule(analysisSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const analysisModule = { exports: {} };
const analysisContext = {
  console: { ...console, debug: () => {} }, // suppress debug noise during test execution
  Float32Array,
  Float64Array,
  Uint8Array,
  Math,
  exports: analysisModule.exports,
  module: analysisModule
};
vm.createContext(analysisContext);
vm.runInContext(compiledAnalysis, analysisContext);

// 2. Compile audioAnalysis.test.ts
const testSrc = fs.readFileSync(path.join(__dirname, '../src/utils/audioAnalysis.test.ts'), 'utf8');
const compiledTest = ts.transpileModule(testSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const testSandbox = {
  console,
  Float32Array,
  Float64Array,
  Uint8Array,
  Math,
  require: (id) => {
    if (id === 'vitest') {
      return { describe, it, expect, test: it, beforeEach: () => {}, afterEach: () => {} };
    }
    if (id === './audioAnalysis') {
      return analysisModule.exports;
    }
    return require(id);
  },
  exports: {},
  module: { exports: {} }
};

vm.createContext(testSandbox);
console.log('\x1b[1m=== Running Vitest Suite (src/utils/audioAnalysis.test.ts) ===\x1b[0m');
vm.runInContext(compiledTest, testSandbox);

console.log(`\n\x1b[32m\x1b[1m✓ ALL ${passedTests} OF ${totalTests} UNIT TESTS PASSED!\x1b[0m\n`);

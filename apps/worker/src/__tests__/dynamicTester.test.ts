import { describe, it, expect } from 'vitest';
import { getApiTestCases, evaluateApiTestResult } from '../dynamicTester';

describe('Dynamic API Fuzzer Improvements (Item C.12)', () => {
  describe('getApiTestCases', () => {
    it('skips empty-body and invalid data type tests for GET and HEAD requests', () => {
      const getCases = getApiTestCases('GET');
      expect(getCases.some((c) => c.name.includes('Empty Body'))).toBe(false);
      expect(getCases.some((c) => c.name.includes('Invalid Data Types'))).toBe(false);
      expect(getCases.length).toBe(1);
      expect(getCases[0].name).toBe('Standard Request');
      expect(getCases[0].isBodyTest).toBe(false);

      const headCases = getApiTestCases('HEAD');
      expect(headCases.some((c) => c.name.includes('Empty Body'))).toBe(false);
      expect(headCases.some((c) => c.name.includes('Invalid Data Types'))).toBe(false);
      expect(headCases[0].isBodyTest).toBe(false);
    });

    it('generates empty-body and invalid-types body test cases for POST, PUT, and PATCH', () => {
      for (const method of ['POST', 'PUT', 'PATCH']) {
        const cases = getApiTestCases(method);
        expect(cases.length).toBe(2);
        expect(cases[0].name).toBe('Missing Required Fields / Empty Body');
        expect(cases[0].isBodyTest).toBe(true);
        expect(cases[0].payload).toEqual({});

        expect(cases[1].name).toBe('Invalid Data Types');
        expect(cases[1].isBodyTest).toBe(true);
      }
    });

    it('returns empty array for unknown or unsupported methods', () => {
      expect(getApiTestCases('LISTEN')).toEqual([]);
    });
  });

  describe('evaluateApiTestResult', () => {
    const postEmptyCase = { name: 'Missing Required Fields / Empty Body', payload: {}, isBodyTest: true };
    const getStandardCase = { name: 'Standard Request', isBodyTest: false };

    it('treats 4xx on body test as a pass (validation successfully rejected invalid input)', () => {
      const result400 = evaluateApiTestResult('POST', '/items', 'routes.js', postEmptyCase, 400);
      expect(result400.ruleId).toBe('api-test-passed');
      expect(result400.severity).toBe('info');
      expect(result400.message).toContain('correctly returned 400');

      const result422 = evaluateApiTestResult('POST', '/items', 'routes.js', postEmptyCase, 422);
      expect(result422.ruleId).toBe('api-test-passed');
      expect(result422.severity).toBe('info');
    });

    it('treats 5xx on malformed input as a finding ("server error on malformed input"), not a pass', () => {
      const result500 = evaluateApiTestResult('POST', '/items', 'routes.js', postEmptyCase, 500);
      expect(result500.ruleId).toBe('server-error-on-malformed-input');
      expect(result500.severity).toBe('medium');
      expect(result500.message).toContain('server error on malformed input (500)');
      expect(result500.message).toContain('Expected 4xx client error');

      const result502 = evaluateApiTestResult('PUT', '/users', 'routes.js', postEmptyCase, 502);
      expect(result502.ruleId).toBe('server-error-on-malformed-input');
    });

    it('treats 200 on empty body test for POST as a failure (missing validation, expected 4xx)', () => {
      const result200 = evaluateApiTestResult('POST', '/items', 'routes.js', postEmptyCase, 200);
      expect(result200.ruleId).toBe('api-test-failed');
      expect(result200.severity).toBe('medium');
      expect(result200.message).toContain('returned 200 for test case: \'Missing Required Fields / Empty Body\', expected 4xx client error');
    });

    it('treats 200 on GET /search as a pass (GET has no body)', () => {
      const result = evaluateApiTestResult('GET', '/search', 'index.js', getStandardCase, 200);
      expect(result.ruleId).toBe('api-test-passed');
      expect(result.severity).toBe('info');
      expect(result.message).toContain('GET /search correctly returned 200');
    });
  });
});

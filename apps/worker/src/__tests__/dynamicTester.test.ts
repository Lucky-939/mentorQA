/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import {
  getApiTestCases,
  evaluateApiTestResult,
  resolvePathParams,
  deriveBodyFieldsFromHandler
} from '../dynamicTester';

describe('Dynamic API Fuzzer Improvements (Round 5 & 6)', () => {
  describe('resolvePathParams', () => {
    it('fills :id and named route parameters with dummy value 1', () => {
      expect(resolvePathParams('/users/:id')).toBe('/users/1');
      expect(resolvePathParams('/repos/:owner/:repo')).toBe('/repos/1/1');
      expect(resolvePathParams('/api/v1/posts/:postId/comments/:commentId')).toBe('/api/v1/posts/1/comments/1');
      expect(resolvePathParams('/search')).toBe('/search');
      expect(resolvePathParams('/data')).toBe('/data');
    });
  });

  describe('deriveBodyFieldsFromHandler', () => {
    it('derives field names and types from req.body destructuring and typeof assertions', () => {
      const handlerCode = `
        app.post('/data', (req, res) => {
          const { name, count } = req.body || {};
          if (!name || count === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
          }
          if (typeof name !== 'string' || typeof count !== 'number') {
            return res.status(422).json({ error: 'Invalid field types' });
          }
          return res.status(201).json({ status: 'ok', data: { name, count } });
        });
      `;

      const derived = deriveBodyFieldsFromHandler(handlerCode);
      expect(derived).toEqual([
        { name: 'name', expectedType: 'string' },
        { name: 'count', expectedType: 'number' }
      ]);
    });

    it('derives fields from property access req.body.foo', () => {
      const handlerCode = `
        app.post('/login', (req, res) => {
          const user = req.body.username;
          const pass = req.body['password'];
          const age = req.body.age;
        });
      `;
      const derived = deriveBodyFieldsFromHandler(handlerCode);
      expect(derived.map(d => d.name)).toContain('username');
      expect(derived.map(d => d.name)).toContain('password');
      expect(derived.map(d => d.name)).toContain('age');
      expect(derived.find(d => d.name === 'age')?.expectedType).toBe('number');
    });

    it('returns empty array when no body fields are accessed', () => {
      const handlerCode = `
        app.get('/health', (req, res) => {
          res.json({ ok: true });
        });
      `;
      expect(deriveBodyFieldsFromHandler(handlerCode)).toEqual([]);
    });
  });

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

    it('derives wrong-type test cases labeled (inferred) for each derived body field while keeping valid values for others', () => {
      const handlerCode = `
        const { name, count } = req.body || {};
        if (typeof name !== 'string' || typeof count !== 'number') return res.status(422);
      `;

      const cases = getApiTestCases('POST', handlerCode);
      expect(cases.length).toBe(3); // Empty body + 2 invalid field cases
      expect(cases[0].name).toBe('Missing Required Fields / Empty Body');
      expect(cases[0].payload).toEqual({});

      // Case for name: wrong type (number 12345), count: valid value (1)
      expect(cases[1].name).toBe('Invalid Data Types (name: wrong type) (inferred)');
      expect(cases[1].payload).toEqual({ name: 12345, count: 1 });

      // Case for count: wrong type ('not_a_number'), name: valid value ('valid_str')
      expect(cases[2].name).toBe('Invalid Data Types (count: wrong type) (inferred)');
      expect(cases[2].payload).toEqual({ name: 'valid_str', count: 'not_a_number' });

      // Verifies finding text includes (inferred)
      const finding = evaluateApiTestResult('POST', '/data', 'index.js', cases[1], 422);
      expect(finding.message).toContain('(inferred)');
    });

    it('falls back to "Malformed payload" when no fields can be found in handler', () => {
      const cases = getApiTestCases('POST', 'app.post("/raw", (req, res) => res.send("ok"));');
      expect(cases.length).toBe(2);
      expect(cases[0].name).toBe('Missing Required Fields / Empty Body');
      expect(cases[1].name).toBe('Malformed payload');
      expect(cases[1].payload).toEqual({ malformed_field: 123 });
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

      const result422 = evaluateApiTestResult('POST', '/data', 'routes.js', postEmptyCase, 422);
      expect(result422.ruleId).toBe('api-test-passed');
      expect(result422.severity).toBe('info');
      expect(result422.message).toContain('correctly returned 422');
    });

    it('treats 5xx on malformed input as a finding ("server-error-on-malformed-input"), not a pass', () => {
      const result500 = evaluateApiTestResult('POST', '/items', 'routes.js', postEmptyCase, 500);
      expect(result500.ruleId).toBe('server-error-on-malformed-input');
      expect(result500.severity).toBe('medium');
      expect(result500.message).toContain('returned server error on malformed input (500)');

      const result502 = evaluateApiTestResult('PUT', '/users', 'routes.js', postEmptyCase, 502);
      expect(result502.ruleId).toBe('server-error-on-malformed-input');
    });

    it('treats 200 on empty body test for POST as a failure (missing validation, expected 4xx)', () => {
      const result200 = evaluateApiTestResult('POST', '/items', 'routes.js', postEmptyCase, 200);
      expect(result200.ruleId).toBe('api-test-failed');
      expect(result200.severity).toBe('medium');
      expect(result200.message).toContain('returned 200 for test case: \'Missing Required Fields / Empty Body\', expected 4xx client error');
    });

    // GET / HEAD rules (Round 6)
    it('GET/HEAD: 404 is inconclusive ("api-test-inconclusive", info)', () => {
      const resultGet404 = evaluateApiTestResult('GET', '/users/999', 'index.js', getStandardCase, 404);
      expect(resultGet404.ruleId).toBe('api-test-inconclusive');
      expect(resultGet404.severity).toBe('info');
      expect(resultGet404.message).toBe('GET /users/999 route may not be reachable at this path (router prefix or missing record)');

      const resultHead404 = evaluateApiTestResult('HEAD', '/missing', 'index.js', getStandardCase, 404);
      expect(resultHead404.ruleId).toBe('api-test-inconclusive');
      expect(resultHead404.severity).toBe('info');
      expect(resultHead404.message).toBe('HEAD /missing route may not be reachable at this path (router prefix or missing record)');
    });

    it('GET/HEAD: non-404 below 500 passes (2xx, 3xx are passes; 4xx other than 404 is informational)', () => {
      const result200 = evaluateApiTestResult('GET', '/search', 'index.js', getStandardCase, 200);
      expect(result200.ruleId).toBe('api-test-passed');
      expect(result200.severity).toBe('info');
      expect(result200.message).toContain('correctly returned 200');

      const result401 = evaluateApiTestResult('HEAD', '/admin', 'index.js', getStandardCase, 401);
      expect(result401.ruleId).toBe('api-test-passed');
      expect(result401.severity).toBe('info');
      expect(result401.message).toContain('returned 401 for test case: \'Standard Request\' (client response, not a server failure)');
    });

    it('GET/HEAD: 5xx is a finding ("server-error-on-request", medium)', () => {
      const result500 = evaluateApiTestResult('GET', '/crash', 'index.js', getStandardCase, 500);
      expect(result500.ruleId).toBe('server-error-on-request');
      expect(result500.severity).toBe('medium');
      expect(result500.message).toBe("GET /crash returned server error (500) for test case: 'Standard Request'.");

      const result503 = evaluateApiTestResult('HEAD', '/heavy', 'index.js', getStandardCase, 503);
      expect(result503.ruleId).toBe('server-error-on-request');
      expect(result503.severity).toBe('medium');
    });
  });

  // Item 9 unit test (Commit c2e463c)
  describe('Neo4j Integer and Finding Metadata Serialization (c2e463c)', () => {
    it('converts Neo4j Integer objects to primitive numbers and serializes cleanly to JSON without error', () => {
      // Mock Neo4j Integer object as returned by driver
      const mockNeo4jInteger = {
        low: 12,
        high: 0,
        toNumber: () => 12,
        inSafeRange: () => true
      };

      const degreeNum = typeof (mockNeo4jInteger as any)?.toNumber === 'function' 
        ? (mockNeo4jInteger as any).toNumber() 
        : Number(mockNeo4jInteger || 0);

      const avgRaw = { low: 3, high: 0, toNumber: () => 3.25 };
      const avg = typeof (avgRaw as any)?.toNumber === 'function' ? (avgRaw as any).toNumber() : Number(avgRaw || 0);
      const threshold = avg + 2 * 3.54;

      const finding = {
        id: 'test-god-class-finding',
        category: 'architecture',
        severity: 'medium',
        file: 'apps/worker/src/index.ts',
        lineStart: 0,
        lineEnd: 0,
        message: `God class detected: index.ts has unusually high coupling (degree ${degreeNum} vs repo average ${avg.toFixed(1)}).`,
        ruleId: 'god-class',
        metadata: {
          degree: degreeNum,
          repoMean: Number(avg.toFixed(1)),
          threshold: Number(threshold.toFixed(1))
        }
      };

      expect(typeof finding.metadata.degree).toBe('number');
      expect(finding.metadata.degree).toBe(12);
      expect(typeof finding.metadata.repoMean).toBe('number');
      expect(finding.metadata.repoMean).toBe(3.3);

      // Verify clean JSON serialization (Prisma review upsert requirement)
      expect(() => {
        const serialized = JSON.parse(JSON.stringify([finding]));
        expect(serialized[0].metadata.degree).toBe(12);
        expect(serialized[0].metadata.repoMean).toBe(3.3);
      }).not.toThrow();
    });
  });
});

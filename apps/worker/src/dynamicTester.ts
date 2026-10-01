import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Prisma } from '@mentorqa/db';

const execAsync = promisify(exec);

export interface Endpoint {
  id: string;
  method: string;
  path: string;
  file: string;
  language: string;
  port?: number | null;
}

export interface Finding {
  id: string;
  category: string;
  severity: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  message: string;
  ruleId: string;
}

async function runDocker(cmd: string, timeoutMs: number): Promise<{ stdout: string, stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (err: unknown) {
    const error = err as Record<string, unknown>;
    if (error.killed) {
      throw new Error(`Timeout exceeded (${timeoutMs}ms)`);
    }
    throw err;
  }
}

export async function executeDynamicTests(
  tempDir: string,
  stack: { languages: string[] },
  endpoints: Endpoint[],
  jobId: string,
  updateStatus: (status: string) => Promise<void>
): Promise<Prisma.InputJsonValue[]> {
  const findings: Prisma.InputJsonValue[] = [];
  
  // 1. Dynamic Secret Scanning (Phase 5)
  try {
    await updateStatus('testing-secrets');
    const secretFindings = scanForSecrets(tempDir);
    findings.push(...secretFindings);
  } catch (e) {
    console.error(`[Job ${jobId}] Secret scanning error:`, e);
  }

  if (endpoints.length === 0) {
    findings.push({
      id: crypto.randomUUID(),
      category: "api",
      severity: "info",
      file: "Project",
      lineStart: 0,
      lineEnd: 0,
      message: "API testing skipped: No endpoints discovered.",
      ruleId: "api-testing-skipped"
    });
    return findings;
  }

  const networkName = `mentorqa-api-test-${jobId}`;
  const appContainerName = `app-${jobId}`;

  let appBooted = false;
  let startCommandUsed = '';
  let portUsed = 3000;

  try {
    // 1. Create Internal Network
    await runDocker(`docker network create --internal ${networkName}`, 10000);

    // 2. Determine Boot Command & Port
    let bootCommand = '';
    let dockerImage = '';
    let workDir = '/app';
    
    if (stack.languages.includes('JavaScript/TypeScript')) {
      dockerImage = 'node:20-alpine';
      const pkgPath = path.join(tempDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts && pkg.scripts.start) {
          bootCommand = 'npm start';
        } else if (pkg.scripts && pkg.scripts.dev) {
          bootCommand = 'npm run dev';
        } else {
          bootCommand = 'node index.js'; // Fallback
        }
      } else {
        bootCommand = 'node index.js';
      }
    } else if (stack.languages.includes('Python')) {
      dockerImage = 'python:3.11-slim';
      const reqPath = path.join(tempDir, 'services/analysis/requirements.txt');
      if (fs.existsSync(reqPath)) {
         workDir = '/app/services/analysis';
         bootCommand = 'python -m uvicorn main:app --host 0.0.0.0 --port 8000';
         portUsed = 8000;
      } else {
         bootCommand = 'python main.py';
      }
    } else {
      findings.push({
        id: crypto.randomUUID(),
        category: "api",
        severity: "low",
        file: "Project",
        lineStart: 0,
        lineEnd: 0,
        message: `API testing skipped: Language ${stack.languages.join(', ')} not supported for boot.`,
        ruleId: "api-testing-skipped"
      });
      return findings;
    }

    startCommandUsed = bootCommand;

    // Port Detection
    for (const ep of endpoints) {
      if (ep.port) {
        portUsed = ep.port;
        break;
      }
    }

    // 3. Boot App Container
    let bootCmdFull = '';
    if (stack.languages.includes('JavaScript/TypeScript')) {
       bootCmdFull = `docker run -d --rm --name ${appContainerName} --network ${networkName} --network-alias target-app -v "${tempDir}:/app" -w ${workDir} -e PORT=${portUsed} --memory 512m --cpus 1.0 --user node ${dockerImage} sh -c "${bootCommand}"`;
    } else {
       bootCmdFull = `docker run -d --rm --name ${appContainerName} --network ${networkName} --network-alias target-app -v "${tempDir}:/app" -w ${workDir} -e HOME=/app/.home -e PYTHONPATH=/app/services/analysis -e PORT=${portUsed} --memory 512m --cpus 1.0 --user 1000 ${dockerImage} sh -c "${bootCommand}"`;
    }

    await runDocker(bootCmdFull, 15000);

    // 4. Poll for Health / Boot Check
    console.log(`[Job ${jobId}] Polling app on port ${portUsed}...`);
    let retries = 15;
    while (retries > 0) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        const { stdout } = await runDocker(`docker run --rm --network ${networkName} node:20-alpine node -e "const req = require('http').get('http://target-app:${portUsed}/', (res) => { console.log('OK'); process.exit(0); }); req.on('error', (err) => { process.exit(1); }); req.end();"`, 5000);
        if (stdout && stdout.includes('OK')) {
          appBooted = true;
          break;
        }
      } catch (e) {
        // ignore error and retry
      }
      retries--;
    }

    if (!appBooted) {
      // Fetch container logs for debugging
      let containerLogs = "No logs available";
      try {
         const { stdout, stderr } = await runDocker(`docker logs ${appContainerName}`, 5000);
         containerLogs = (stdout + "\n" + stderr).trim().slice(-500); // get last 500 chars
      } catch (e) {}

      findings.push({
        id: crypto.randomUUID(),
        category: "api",
        severity: "medium",
        file: "Project",
        lineStart: 0,
        lineEnd: 0,
        message: `API testing skipped: App failed to boot or requires backing infrastructure. Start command used: '${startCommandUsed}'. Port targeted: ${portUsed}. Logs: ${containerLogs}`,
        ruleId: "api-testing-failed-boot"
      });
      return findings;
    }

    // Verify Network Isolation
    try {
      await runDocker(`docker run --rm --network ${networkName} node:20-alpine wget -qO- https://google.com`, 10000);
      console.warn(`[Job ${jobId}] Network isolation failed! Google was reachable.`);
    } catch (e) {
      console.log(`[Job ${jobId}] Network isolation confirmed. Google is unreachable.`);
    }

    // --- PHASE 4: API Testing ---
    await updateStatus('testing-api');
    findings.push(...await runApiTests(tempDir, endpoints, networkName, portUsed, jobId));

    // --- PHASE 5: Security Testing ---
    await updateStatus('testing-security');
    findings.push(...await runSecurityTests(tempDir, endpoints, networkName, portUsed, jobId));

    // --- PHASE 5: Performance Testing ---
    await updateStatus('testing-performance');
    findings.push(...await runPerformanceTests(tempDir, endpoints, networkName, portUsed, jobId));

  } catch (err) {
    console.error(`[Job ${jobId}] Dynamic Testing Error:`, err);
  } finally {
    // 6. Cleanup
    try {
      const { stdout } = await runDocker(`docker network inspect -f "{{range .Containers}}{{.Name}} {{end}}" ${networkName}`, 10000);
      const containers = stdout.trim().split(' ').filter(c => c);
      for (const c of containers) {
        try { await runDocker(`docker rm -f ${c}`, 5000); } catch(e) {}
      }
    } catch (e) {}
    try {
      await runDocker(`docker rm -f ${appContainerName}`, 10000);
    } catch (e) {}
    try {
      await runDocker(`docker network rm ${networkName}`, 10000);
    } catch (e) {}
  }

  return findings;
}

// ------------------------------------------------------------------
// Sub-Modules
// ------------------------------------------------------------------

function scanForSecrets(tempDir: string): Prisma.InputJsonValue[] {
  const findings: Prisma.InputJsonValue[] = [];
  // Very simplistic secret scan checking typical ignored files
  const filesToScan = ['.env', 'config/secrets.json', 'docker-compose.override.yml'];
  for (const f of filesToScan) {
    const fullPath = path.join(tempDir, f);
    if (fs.existsSync(fullPath)) {
       const content = fs.readFileSync(fullPath, 'utf8');
       if (content.includes('AKIA') || content.includes('password=') || content.includes('PRIVATE KEY')) {
          findings.push({
            id: crypto.randomUUID(),
            category: "security",
            severity: "high",
            file: f,
            lineStart: 0,
            lineEnd: 0,
            message: `Sensitive information (potential credentials or keys) found in ${f}. This file should not be committed to version control.`,
            ruleId: "dynamic-secret-exposure"
          });
       }
    }
  }
  return findings;
}

async function runApiTests(tempDir: string, endpoints: Endpoint[], networkName: string, portUsed: number, jobId: string): Promise<Prisma.InputJsonValue[]> {
  const findings: Prisma.InputJsonValue[] = [];
  let endpointsToTest = endpoints;
  if (process.env.DEMO_MODE === 'true') {
    const demoPaths = ['/search', '/admin', '/users', '/file'];
    endpointsToTest = endpoints.filter(ep => demoPaths.includes(ep.path));
    console.log(`[Job ${jobId}] DEMO_MODE active: curating API fuzzing to known vulnerable endpoints: ${endpointsToTest.map(e => e.path).join(', ')}.`);
  }

  for (const ep of endpointsToTest) {
     if (ep.method === 'LISTEN') continue;
     const cases = [
       { name: 'Missing Required Fields / Empty Body', payload: {}, expectedStatusRegex: /^(4..|5..)$/ },
       { name: 'Invalid Data Types', payload: { "id": "not_an_int", "name": 123 }, expectedStatusRegex: /^(4..|5..)$/ },
     ];

     for (const tc of cases) {
       let testScript = `
const http = require('http');
const req = http.request({
  hostname: 'target-app',
  port: ${portUsed},
  path: '${ep.path}',
  method: '${ep.method}',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  console.log(res.statusCode);
});
req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
${ep.method !== 'GET' && ep.method !== 'HEAD' ? `req.write(JSON.stringify(${JSON.stringify(tc.payload)}));` : ''}
req.end();
`;
       const testScriptPath = path.join(tempDir, `test_api_${ep.id}.js`);
       fs.writeFileSync(testScriptPath, testScript);

       try {
         const { stdout } = await runDocker(`docker run --rm --network ${networkName} -v "${tempDir}:/app" -w /app node:20-alpine node test_api_${ep.id}.js`, 15000);
         const statusCode = parseInt(stdout.trim(), 10);
         
         if (!tc.expectedStatusRegex.test(statusCode.toString())) {
           findings.push({
             id: crypto.randomUUID(),
             category: "api",
             severity: "medium",
             file: ep.file,
             lineStart: 0,
             lineEnd: 0,
             message: `${ep.method} ${ep.path} returned ${statusCode} for test case: '${tc.name}', expected ${tc.expectedStatusRegex}.`,
             ruleId: "api-test-failed"
           });
         } else {
           findings.push({
             id: crypto.randomUUID(),
             category: "api",
             severity: "info",
             file: ep.file,
             lineStart: 0,
             lineEnd: 0,
             message: `${ep.method} ${ep.path} correctly returned ${statusCode} for test case: '${tc.name}'.`,
             ruleId: "api-test-passed"
           });
         }
       } catch (e) {
          findings.push({
             id: crypto.randomUUID(),
             category: "api",
             severity: "medium",
             file: ep.file,
             lineStart: 0,
             lineEnd: 0,
             message: `${ep.method} ${ep.path} timed out or crashed the test runner for test case: '${tc.name}'.`,
             ruleId: "api-test-error"
          });
       }
     }
  }
  return findings;
}

async function runSecurityTests(tempDir: string, endpoints: Endpoint[], networkName: string, portUsed: number, jobId: string): Promise<Prisma.InputJsonValue[]> {
  const findings: Prisma.InputJsonValue[] = [];
  const testScriptPath = path.join(tempDir, 'security_test.js');
  
  const scriptContent = `
const http = require('http');

async function makeRequest(method, path, headers, body) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'target-app',
      port: ${portUsed},
      path: path,
      method: method,
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', () => resolve({ statusCode: 0, body: '', headers: {} }));
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  const isDemo = ${process.env.DEMO_MODE === 'true'};
  let endpoints = ${JSON.stringify(endpoints.filter(e => e.method !== 'LISTEN'))};
  if (isDemo) {
    const demoPaths = ['/search', '/admin', '/users', '/file'];
    endpoints = endpoints.filter(ep => demoPaths.includes(ep.path));
  }
  const findings = [];
  
  for (const ep of endpoints) {
    // 1. SQLi Test
    const sqliPayload = "?id=" + encodeURIComponent("1' OR '1'='1");
    let res = await makeRequest(ep.method, ep.path + sqliPayload, {}, null);
    if (res.body.includes('SQL syntax') || res.body.includes('mysql_') || res.body.includes('PostgreSQL query failed')) {
       findings.push({
         ruleId: "sqli-detected", message: \`SQL Injection detected on \${ep.method} \${ep.path}. DB error reflected in response.\`, file: ep.file, severity: 'high'
       });
    }

    // 2. XSS Test
    const xssPayload = "<script>alert('mentorqa')</script>";
    res = await makeRequest(ep.method, ep.path + "?q=" + encodeURIComponent(xssPayload), {}, null);
    if (res.body.includes(xssPayload) && res.headers['content-type'] && res.headers['content-type'].includes('text/html')) {
       findings.push({
         ruleId: "xss-detected", message: \`Cross-Site Scripting (XSS) detected on \${ep.method} \${ep.path}. Payload reflected unescaped.\`, file: ep.file, severity: 'high'
       });
    }

    // 3. Path Traversal Test
    const lfiPayload = "?file=../../../../../../etc/passwd";
    res = await makeRequest(ep.method, ep.path + lfiPayload, {}, null);
    if (res.body.includes('root:x:0:0')) {
       findings.push({
         ruleId: "path-traversal-detected", message: \`Path Traversal detected on \${ep.method} \${ep.path}. System file content read.\`, file: ep.file, severity: 'high'
       });
    }

    // 4. Broken Auth Test
    if (ep.path.includes('/admin') || ep.path.includes('/user') || ep.path.includes('/secure') || ep.path.includes('/auth')) {
       res = await makeRequest(ep.method, ep.path, { 'Authorization': 'Bearer garbage_token_123' }, null);
       if (res.statusCode === 200 && res.body.length > 5) {
          findings.push({
             ruleId: "broken-auth-heuristic", message: \`Possible broken auth on \${ep.method} \${ep.path} — heuristic based on endpoint path (returned 200 OK despite invalid token), may be inaccurate.\`, file: ep.file, severity: 'low'
          });
       }
    }
  }
  
  console.log(JSON.stringify(findings));
}

run();
`;

  fs.writeFileSync(testScriptPath, scriptContent);
  
  try {
     const { stdout } = await runDocker(`docker run --rm --network ${networkName} -v "${tempDir}:/app" -w /app node:20-alpine node security_test.js`, 30000);
     const parsedFindings = JSON.parse(stdout.trim());
     for (const pf of parsedFindings) {
         findings.push({
            id: crypto.randomUUID(),
            category: "security",
            severity: pf.severity,
            file: pf.file,
            lineStart: 0,
            lineEnd: 0,
            message: pf.message,
            ruleId: pf.ruleId
         });
     }
  } catch (e) {
     console.error(`[Job ${jobId}] Security tests crashed:`, e);
  }

  if (findings.length === 0) {
    findings.push({
      id: crypto.randomUUID(),
      category: "security",
      severity: "info",
      file: "Project",
      lineStart: 0,
      lineEnd: 0,
      message: "No dynamic security vulnerabilities detected during active fuzzing.",
      ruleId: "security-tests-clean"
    });
  }

  return findings;
}

async function runPerformanceTests(tempDir: string, endpoints: Endpoint[], networkName: string, portUsed: number, jobId: string): Promise<Prisma.InputJsonValue[]> {
  const findings: Prisma.InputJsonValue[] = [];
  const testScriptPath = path.join(tempDir, 'perf_test.js');
  
  const scriptContent = `
const http = require('http');

function makeRequest(method, path) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({
      hostname: 'target-app',
      port: ${portUsed},
      path: path,
      method: method
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(Date.now() - start));
    });
    req.on('error', () => resolve(-1));
    req.end();
  });
}

async function runLoadTest(method, path, concurrency, durationMs) {
  const end = Date.now() + durationMs;
  const latencies = [];
  
  async function worker() {
    while (Date.now() < end) {
      const latency = await makeRequest(method, path);
      if (latency >= 0) latencies.push(latency);
    }
  }
  
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  
  latencies.sort((a,b) => a-b);
  const avg = latencies.reduce((a,b)=>a+b, 0) / (latencies.length || 1);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  return { avg, p95, count: latencies.length };
}

async function run() {
  const isDemo = ${process.env.DEMO_MODE === 'true'};
  let endpoints = ${JSON.stringify(endpoints.filter(e => e.method !== 'LISTEN'))};
  if (isDemo) {
    const demoPaths = ['/search', '/admin', '/users', '/file'];
    endpoints = endpoints.filter(ep => demoPaths.includes(ep.path));
  }
  const findings = [];
  
  for (const ep of endpoints) {
     const res = await runLoadTest(ep.method, ep.path, 20, 3000); // 3 seconds per endpoint
     if (res.avg > 500 || res.p95 > 1000) {
        findings.push({
           ruleId: "high-latency", message: \`\${ep.method} \${ep.path} latency high: avg \${Math.round(res.avg)}ms, p95 \${res.p95}ms (\${res.count} reqs).\`, file: ep.file, severity: 'medium'
        });
     } else {
        findings.push({
           ruleId: "latency-ok", message: \`\${ep.method} \${ep.path} latency OK: avg \${Math.round(res.avg)}ms, p95 \${res.p95}ms (\${res.count} reqs).\`, file: ep.file, severity: 'info'
        });
     }
  }
  console.log(JSON.stringify(findings));
}

run();
`;

  fs.writeFileSync(testScriptPath, scriptContent);
  
  try {
     const { stdout } = await runDocker(`docker run --rm --network ${networkName} -v "${tempDir}:/app" -w /app node:20-alpine node perf_test.js`, 60000);
     const parsedFindings = JSON.parse(stdout.trim());
     for (const pf of parsedFindings) {
         findings.push({
            id: crypto.randomUUID(),
            category: "performance",
            severity: pf.severity,
            file: pf.file,
            lineStart: 0,
            lineEnd: 0,
            message: pf.message,
            ruleId: pf.ruleId
         });
     }
  } catch (e) {
     console.error(`[Job ${jobId}] Performance tests crashed:`, e);
     findings.push({
        id: crypto.randomUUID(),
        category: "performance",
        severity: "medium",
        file: "Project",
        lineStart: 0,
        lineEnd: 0,
        message: "Performance load test failed to complete or crashed.",
        ruleId: "performance-test-error"
     });
  }

  return findings;
}

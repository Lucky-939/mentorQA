import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { KeyFunction } from './testGenerator';

const execAsync = promisify(exec);

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

export async function setupSandbox(tempDir: string, stack: { languages: string[] }): Promise<void> {
  console.log('[Sandbox] Running setup stage (network allowed)...');
  
  if (stack.languages.includes('JavaScript/TypeScript')) {
    // Stage 1: npm install --ignore-scripts
    if (fs.existsSync(path.join(tempDir, 'package.json'))) {
      await runDocker(`docker run --rm -v "${tempDir}:/app" -w /app --user node node:20-alpine npm install --ignore-scripts`, 90000);
      // Install jest globally in the project so npx jest works
      await runDocker(`docker run --rm -v "${tempDir}:/app" -w /app --user node node:20-alpine npm install --no-save --ignore-scripts jest @types/jest`, 60000);
    }
  } else if (stack.languages.includes('Python')) {
    if (fs.existsSync(path.join(tempDir, 'requirements.txt'))) {
      // Python pip install --no-deps
      await runDocker(`docker run --rm -v "${tempDir}:/app" -w /app --user 1000 python:3.11-slim pip install --no-deps --user -r requirements.txt`, 90000);
    }
    await runDocker(`docker run --rm -v "${tempDir}:/app" -w /app --user 1000 python:3.11-slim pip install --user pytest`, 60000);
  } else if (stack.languages.includes('Java')) {
    // Java Maven setup
    if (fs.existsSync(path.join(tempDir, 'pom.xml'))) {
      await runDocker(`docker run --rm -v "${tempDir}:/app" -w /app --user 1000 maven:3.9-amazoncorretto-17 mvn dependency:resolve -q`, 120000);
    }
  }
}

export async function executeTest(
  tempDir: string,
  func: KeyFunction,
  testCode: string
): Promise<{ passed: boolean, message: string }> {
  const testFileName = `test_${func.name}_${Date.now()}`;
  let relativeTestPath = '';
  let cmd = '';

  if (func.language === 'javascript' || func.language === 'typescript') {
    relativeTestPath = `${testFileName}.test.js`;
    cmd = `docker run --rm --network none --memory 256m --cpus 0.5 -v "${tempDir}:/app" -w /app --user node node:20-alpine npx jest ${relativeTestPath}`;
  } else if (func.language === 'python') {
    relativeTestPath = `${testFileName}_test.py`;
    cmd = `docker run --rm --network none --memory 256m --cpus 0.5 -v "${tempDir}:/app" -w /app --user 1000 python:3.11-slim python -m pytest ${relativeTestPath}`;
  } else if (func.language === 'Java') {
    relativeTestPath = `src/test/java/${testFileName}Test.java`;
    cmd = `docker run --rm --network none --memory 512m --cpus 1.0 -v "${tempDir}:/app" -w /app --user 1000 maven:3.9-amazoncorretto-17 mvn test -Dtest=${testFileName}Test -q`;
  } else {
    return { passed: false, message: 'Unsupported language for sandboxed test execution.' };
  }

  const absoluteTestPath = path.join(tempDir, relativeTestPath);
  fs.mkdirSync(path.dirname(absoluteTestPath), { recursive: true });
  fs.writeFileSync(absoluteTestPath, testCode, 'utf8');

  try {
    const { stdout } = await runDocker(cmd, 15000);
    return { passed: true, message: 'Generated test passed successfully.\n' + stdout.substring(0, 500) };
  } catch (err: unknown) {
    const error = err as Record<string, unknown>;
    return { 
      passed: false, 
      message: `Generated test failed or timed out.\n${String(error.message)}\n${typeof error.stdout === 'string' ? error.stdout.substring(0, 500) : ''}\n${typeof error.stderr === 'string' ? error.stderr.substring(0, 500) : ''}` 
    };
  } finally {
    // Cleanup the generated test file so it doesn't interfere with next tests
    try { 
      fs.unlinkSync(absoluteTestPath); 
    } catch {
      // Ignored
    }
  }
}

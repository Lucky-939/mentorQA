import { executeTest } from './src/sandbox';
import * as fs from 'fs';
import * as path from 'path';

async function testInfiniteLoop() {
  console.log('Testing infinite loop in sandbox...');
  const testCode = `
    test('infinite loop', () => {
      while(true) {
        // do nothing forever
      }
    });
  `;
  
  const result = await executeTest(
    process.cwd(),
    { name: 'test_func', language: 'javascript', source: '', signature: '' },
    testCode
  );

  console.log('Sandbox result:', result);
}

testInfiniteLoop();

import 'dotenv/config';
import { KeyFunction } from './src/testGenerator';
import { setupSandbox, executeTest } from './src/sandbox';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function run() {
  const pythonFunc: KeyFunction = {
    id: "python-test-id",
    name: "calculate_discount",
    file: "calculator.py",
    language: "python",
    signature: "def calculate_discount(price: float, discount_percent: float) -> float:",
    source: `def calculate_discount(price: float, discount_percent: float) -> float:
    if price < 0 or discount_percent < 0 or discount_percent > 100:
        raise ValueError("Invalid price or discount")
    return price - (price * (discount_percent / 100))`
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mentorqa-py-`));
  fs.writeFileSync(path.join(tempDir, 'calculator.py'), pythonFunc.source);
  fs.writeFileSync(path.join(tempDir, 'requirements.txt'), '');

  console.log('Skipping Gemini generation due to 429 Quota Exceeded...');
  const testCode = `
import pytest
from calculator import calculate_discount

def test_calculate_discount_valid():
    assert calculate_discount(100, 20) == 80.0

def test_calculate_discount_zero_discount():
    assert calculate_discount(50, 0) == 50.0

def test_calculate_discount_invalid_price():
    with pytest.raises(ValueError):
        calculate_discount(-10, 20)
`;

  console.log('\n--- Manually Supplied Python Test ---');
  console.log(testCode);
  console.log('-------------------------------------\n');

  console.log('Running sandbox setup for Python...');
  await setupSandbox(tempDir, { languages: ['Python'], frameworks: [] });

  console.log('Executing test in Python sandbox...');
  const result = await executeTest(tempDir, pythonFunc, testCode);

  console.log('\nSandbox Result:', result);
  
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}

run().catch(console.error);

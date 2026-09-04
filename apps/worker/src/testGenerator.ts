import * as crypto from 'crypto';
import Redis from 'ioredis';

export interface KeyFunction {
  id: string;
  name: string;
  file: string;
  language: string;
  source: string;
  signature: string;
}

export async function generateTestWithGemini(
  func: KeyFunction,
  redis: Redis,
  apiKey: string
): Promise<string | null> {
  const hash = crypto.createHash('sha256').update(func.source).digest('hex');
  const cacheKey = `mentorqa:test-gen:${hash}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log(`[Gemini] Cache hit for function ${func.name}`);
    return cached;
  }

  const prompt = `Write a single, isolated unit test file for the following ${func.language} function.
File: ${func.file}
Function Signature: ${func.signature}

Source:
\`\`\`${func.language}
${func.source}
\`\`\`

If this is javascript/typescript, use Jest.
If Python, use PyTest.
If Java, use JUnit.
Output ONLY the raw executable code for the test file. DO NOT wrap it in markdown code blocks (\`\`\`). Do not include any explanations.`;

  console.log(`[Gemini] Fetching generation for ${func.name}...`);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: "You are an expert tester. Output only raw code. No markdown formatting." }]
      }
    })
  });

  if (res.status === 429) {
    throw new Error('429 Too Many Requests - Gemini quota exceeded.');
  }

  if (!res.ok) {
    throw new Error(`Gemini API Error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const candidate = (data.candidates as Record<string, unknown>[])?.[0]?.content?.parts?.[0]?.text;

  if (!candidate) return null;

  let cleanCode = candidate.trim();
  // Strip markdown blocks if Gemini ignored instructions
  if (cleanCode.startsWith('```')) {
    const lines = cleanCode.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].startsWith('```')) lines.pop();
    cleanCode = lines.join('\n').trim();
  }

  await redis.set(cacheKey, cleanCode, 'EX', 60 * 60 * 24 * 7); // Cache for 7 days
  return cleanCode;
}

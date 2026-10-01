import 'dotenv/config';

async function testModel(modelName: string, apiKey: string) {
  console.log(`\nTesting generateContent on ${modelName}...`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: "Write a simple function." }]
      }
    ],
    generationConfig: {
      temperature: 0.2
    }
  });

  const genRes = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body
  });

  console.log('Response Status:', genRes.status);
  const genData = await genRes.json();
  console.log('Response Data:', JSON.stringify(genData, null, 2));
}

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return;
  await testModel('gemini-3.8-flash', apiKey);
  await testModel('gemini-3.6-flash', apiKey);
}

run();

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Process arguments
const apiKey = process.env.GEMINI_API_KEY;
const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY environment variable not set');
  process.exit(1);
}

if (!inputFile || !outputFile) {
  console.error('Usage: node geminiWrapper.mjs <input-file> <output-file>');
  process.exit(1);
}

async function processRequest() {
  try {
    // Read input parameters
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const { prompt, model = "gemini-2.0-flash-lite" } = input;

    // Initialize AI client
    const genAI = new GoogleGenAI({ apiKey });
    const geminiModel = genAI.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    // Generate response
    const result = await geminiModel;
    const response = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Write output
    fs.writeFileSync(outputFile, JSON.stringify({ success: true, response }), 'utf8');
  } catch (error) {
    // Handle errors
    fs.writeFileSync(outputFile, JSON.stringify({ 
      success: false, 
      error: error.message || 'Unknown error'
    }), 'utf8');
  }
}

processRequest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
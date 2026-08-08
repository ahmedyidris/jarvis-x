#!/usr/bin/env node

const { GoogleGenerativeAI } = require("google-generative-ai");
require('dotenv').config({ path: `${process.env.HOME}/.jarvis-x/.env` });

async function testGemini() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  console.log('\n🤖 Testing Gemini integration...\n');

  const prompt = "In one sentence, what is the purpose of Jarvis X?";
  
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('✅ Gemini API working!\n');
    console.log(`Prompt: ${prompt}\n`);
    console.log(`Response: ${text}\n`);
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

testGemini();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec: execSync } = require('child_process');
const { BASE, safePath } = require('./exec.js');

function reEscape(str) {
  return str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function parseJSONLoose(raw) {
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ACTUAL EXECUTION ENGINE
async function execute(action) {
  const { type } = action;
  switch (type) {
    case 'list': {
      const full = path.resolve(BASE, action.path);
      if (!fs.existsSync(full)) return `Directory not found: ${action.path}`;
      const files = fs.readdirSync(full);
      return files.join('\n');
    }
    case 'read': {
      const full = path.resolve(BASE, action.path);
      if (!fs.existsSync(full)) return `File not found: ${action.path}`;
      const content = fs.readFileSync(full, 'utf8');
      return content;
    }
    case 'write': {
      const full = path.resolve(BASE, action.path);
      // Ensure directory exists
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(full, action.content, 'utf8');
      return `Written to ${action.path}`;
    }
    case 'shell': {
      return new Promise((resolve, reject) => {
        execSync(action.cmd, { cwd: BASE, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) reject(stderr || err.message);
          else resolve(stdout.trim());
        });
      });
    }
    case 'query': {
      // For now, just echo the query – later can route to model
      return `Query: ${action.q}`;
    }
    case 'answer': {
      return action.text;
    }
    default:
      return `Unknown action type: ${type}`;
  }
}

function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, ans => {
      rl.close();
      resolve(ans.toLowerCase().startsWith('y'));
    });
  });
}

module.exports = { reEscape, parseJSONLoose, execute, confirm };

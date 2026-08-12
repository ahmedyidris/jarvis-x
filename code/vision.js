const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function describe(imagePath) {
  const { stdout } = await execPromise(`ollama run moondream "Describe this image: ${imagePath}"`);
  return stdout.trim();
}

// CLI usage
if (require.main === module) {
  const img = process.argv[2];
  if (!img) return console.error('Usage: node vision.js <image_path>');
  describe(img).then(console.log).catch(console.error);
}
module.exports = { describe };

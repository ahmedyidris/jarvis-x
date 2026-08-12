const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function describe(imagePath) {
  try {
    const { stdout } = await execPromise(`ollama run moondream "Describe this image: ${imagePath}"`);
    return stdout.trim();
  } catch (err) {
    throw new Error(`Vision failed: ${err.message}`);
  }
}

if (require.main === module) {
  const img = process.argv[2];
  if (!img) {
    console.error('Usage: node vision.js <image_path>');
    process.exit(1);
  }
  describe(img)
    .then(console.log)
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { describe };

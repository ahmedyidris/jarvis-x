const fs = require('fs');

const MODEL = 'moondream';

// Calls Ollama's HTTP API directly (same pattern as code/local.js) instead of
// shelling out to `ollama run`. Three real bugs in the old exec()-based
// version drove this:
//   1. Hung indefinitely: child_process.exec() leaves the child's stdin as an
//      open, never-EOF'd pipe, and `ollama run` blocks waiting to see if
//      piped stdin is coming when stdout isn't a tty.
//   2. Shell injection / breakage: the image path was interpolated straight
//      into a shell command string, unescaped -- a path with a space or
//      quote would break or inject.
//   3. Garbage output: `ollama run`'s CLI emits ANSI cursor-redraw sequences
//      for its own word-wrapping even when stdout is piped, corrupting the
//      captured text with embedded escape codes mid-word.
// The HTTP API has none of this: no shell, no tty, no CLI rendering -- just
// JSON in, JSON out.
async function describe(imagePath) {
  let imageB64;
  try {
    imageB64 = fs.readFileSync(imagePath).toString('base64');
  } catch (err) {
    throw new Error(`Vision failed: could not read image at ${imagePath}: ${err.message}`);
  }

  let res;
  try {
    res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: 'Describe this image.',
        images: [imageB64],
        stream: false
      })
    });
  } catch (err) {
    throw new Error(`Vision failed: Ollama unreachable (${err.message}). Is ollama running?`);
  }
  if (!res.ok) {
    throw new Error(`Vision failed: Ollama returned ${res.status}`);
  }
  const data = await res.json();
  return data.response.trim();
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

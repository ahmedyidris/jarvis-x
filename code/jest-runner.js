const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const baseDir = __dirname;
const targetArg = process.argv[2];

if (!targetArg) {
    console.error("Error: Please provide a test file name (e.g., test-vision.js)");
    process.exit(1);
}

const cleanFileName = path.basename(targetArg);
const absoluteTestPath = path.join(baseDir, cleanFileName);

if (!fs.existsSync(absoluteTestPath)) {
    console.error(`Error: Test file not found at ${absoluteTestPath}`);
    process.exit(1);
}

console.log(`[HARNESS] Launching isolated test file: ${cleanFileName}`);
try {
    // Escape regex characters and force Jest to run this exact filename matching string
    const escapedRegex = cleanFileName.replace(/\./g, "\\.");
    execSync(`npx jest --no-cache --rootDir="${baseDir}" --testRegex="${escapedRegex}$"`, { stdio: "inherit" });
} catch (error) {
    process.exit(1);
}

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

const fileContent = fs.readFileSync(absoluteTestPath, "utf8");

// Safely route self-executing async scripts to native node threads
if (fileContent.includes("async ()") && !fileContent.includes("describe(") && !fileContent.includes("test(")) {
    console.log(`[HARNESS] Routing raw node async execution path: ${cleanFileName}`);
    try {
        execSync(`node "${absoluteTestPath}"`, { stdio: "inherit" });
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
} else {
    console.log(`[HARNESS] Launching standard Jest unit runner: ${cleanFileName}`);
    try {
        const escapedRegex = cleanFileName.replace(/\./g, "\\.");
        execSync(`npx jest --no-cache --rootDir="${baseDir}" --testRegex="${escapedRegex}$"`, { stdio: "inherit" });
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
}

const { guard } = require("./guard");
const exec = require("child_process").exec;

async function runShell(command) {
    // Enforce the standing permissions from CONSTITUTION.md
    if (!guard(command)) {
        throw new Error("Action blocked by Jarvis Constitution safety parameters.");
    }
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) resolve(stdout || stderr);
            else resolve(stdout);
        });
    });
}

module.exports = { runShell };

import fs from "fs/promises";
import { join } from "path";

import { execSync } from "child_process";

const distThreadPath = join(__dirname, "../Thread.js");
const srcThreadPath = distThreadPath.replace("\\dist\\", "\\src\\");

const runTests = async () => {
	const jestCommand = `jest ${process.argv[2]||""}`;
	process.stdout.write(`Executing \u001b[38;5;208m${jestCommand}\u001b[0m...\n\n\n`);
	execSync(jestCommand, { stdio: "inherit" });
};

(async () => {
	process.stdout.write(`Copying \u001b[38;5;208m${distThreadPath}\u001b[0m to \u001b[38;5;208m${srcThreadPath}\u001b[0m... `);
	await fs.copyFile(distThreadPath, srcThreadPath);
	process.stdout.write("Done!\n");

	await runTests().catch(() => false);

	process.stdout.write(`\n\nRemoving \u001b[38;5;208m${srcThreadPath}\u001b[0m... `);
	await fs.unlink(srcThreadPath);
	process.stdout.write("Done!\n");
})().catch(console.error);
import fs from "fs/promises";
import { join } from "path";

import { execSync } from "child_process";

const runTests = async () => {
	const jestCommand = `jest ${process.argv[2]||""}`;
	process.stdout.write(`Executing \u001b[38;5;208m${jestCommand}\u001b[0m...\n\n\n`);
	execSync(jestCommand, { stdio: "inherit" });
	console.log("\n\n");
};

const patchFile = async(filePath: string, searchValue: string, fillValue: string): Promise<() => Promise<void>> => {
	filePath = join(__dirname, filePath).replace("\\dist\\", "\\src\\");

	process.stdout.write(`Patching ${filePath}, \u001b[38;5;208m${searchValue}\u001b[0m >> \u001b[38;5;208m${fillValue}\u001b[0m...`);
	await fs.writeFile(filePath, (await fs.readFile(filePath)).toString().replace(new RegExp(searchValue, "g"), fillValue));
	process.stdout.write("Done!\n");

	return async () => {
		process.stdout.write(`UnPatching ${filePath}, \u001b[38;5;208m${searchValue}\u001b[0m << \u001b[38;5;208m${fillValue}\u001b[0m...`);
		await fs.writeFile(filePath, (await fs.readFile(filePath)).toString().replace(new RegExp(fillValue, "g"), searchValue));
		process.stdout.write("Done!\n");
	};
};

const testsDir = "../dist/tests";

(async () => {
	// Patch Parent.ts
	const unPatchParent = await patchFile("../parent.ts", "./Thread.js", "../dist/Thread.js");	
	
	// Patch data.test.ts
	const unPatchData = await patchFile("./data.test.ts", "./data.js", `${testsDir}/data.js`);

	await runTests().catch(() => false);

	// UnPatch files...
	await unPatchParent();
	await unPatchData();
})().catch(console.error);
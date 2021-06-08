import { Parent } from "../";
import type * as ExitThread from "./lib/exit";

test("Checks thread errors correctly", () => {
	const errorThread = Parent("./lib/error.js");
	return expect(errorThread.exited).rejects.toEqual(new Error(Date.now().toString())).finally(errorThread.terminate);
});

test("Checks thread exits correctly", () => {
	const errorThread = Parent<typeof ExitThread>("./lib/exit.js");
	const exitCode = Math.random();
	errorThread.exit(exitCode);
	return expect(errorThread.exited).resolves.toEqual(exitCode).finally(errorThread.terminate);
});
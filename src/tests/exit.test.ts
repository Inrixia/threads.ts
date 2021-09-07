import { Parent } from "../";
import type * as ExitThread from "./lib/exit";

test("Checks thread exits correctly", () => {
	const exitThread = Parent<typeof ExitThread>("./lib/exit.js");
	const exitCode = Math.random();
	exitThread.exit(exitCode).catch(() => null);
	return expect(exitThread.exited).resolves.toEqual({ code: exitCode }).finally(exitThread.terminate);
});

test("Checks thread errors correctly", () => {
	const exitThread = Parent("./lib/error.js");
	return expect(exitThread.exited).resolves.toEqual({ err: new Error() }).finally(exitThread.terminate);
});

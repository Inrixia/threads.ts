import { Parent } from "../";
import type * as ExitThread from "./lib/exit";

test("Checks thread exits correctly", () => {
	const exitThread = Parent<typeof ExitThread>("./lib/exit.js");
	const exitCode = Math.random();
	exitThread.exit(exitCode).catch(() => null);
	return expect(exitThread.exited).resolves.toEqual(exitCode).finally(exitThread.terminate);
});

import { Parent } from "../";
import type * as DataThread from "./lib/data";

test("Checks data is correctly passed to a thread", () => {
	const data = { a: "Hello World" };
	const dataThread = Parent<typeof DataThread>("./lib/data.js", { data });
	return expect(dataThread._data()).resolves.toMatchObject(data).finally(dataThread.terminate);
});
import { Parent } from "../";

test("Checks data is correctly passed to a thread", () => {
	const data = { a: "Hello World" };
	const dataThread = Parent("./data.js", { name: "dataThread", data });
	return expect(dataThread._data()).resolves.toMatchObject(data).finally(dataThread.terminate);
});



// test("Checks data is correctly passed to a thread", () => {
// 	const data = { a: "Hello Worlds" };
// 	const dataThread = new ParentPool(path.join(__dirname, "../dist/test./data.js"), { name: "dataThreadPool", data });
// 	return expect(dataThread._data()).resolves.toMatchObject(data);
// });
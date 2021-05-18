import { Parent } from "../";
import type * as Child from "./lib/child";
import type * as Smol from "./lib/smol";

test("Adds 1 in child.js", () => {
	const child = Parent<typeof Child>("./lib/child.js");
	return expect(child.add1(1)).resolves.toBe(2).finally(child.terminate);
});

test("Adds 1 in child.js with depth", () => {
	const child = Parent<typeof Child>("./lib/child.js");
	return expect(child.add1Deep(1)).resolves.toBe(2).finally(child.terminate);
});

test("Queues and runs two functions", () => {
	const child = Parent<typeof Child>("./lib/child.js");
	const expectation = Promise.all([child.queue.return1(), child.queue.return1()]);
	child.runQueue();
	return expect(expectation).resolves.toStrictEqual([1, 1]).finally(child.terminate);
});

test("Requires and runs a function in one thread from another", () => {
	const child = Parent<typeof Child>("./lib/child.js");
	const smol = Parent<typeof Smol>("./lib/smol.js");
	return expect(child.smol(1)).resolves.toBe(2).finally(() => child.terminate() && smol.terminate());
});

// test("Spawns a ParentPool for child and runs four functions", () => {
// 	const child = new ParentPool(childPath, { name: "child" });
// 	return expect(Promise.all([child.add1(1), child.add1(1), child.add1(1), child.add1(1)])).resolves.toStrictEqual([2, 2, 2, 2]);
// });

// test('Requires and runs a function in a thread pool from another', () => {
// 	const child = new Parent(childPath, { name: 'child' })
// 	const smol = new ParentPool(smolPath, { name: 'smol' })
// 	return expect(child.smol(1).catch(console.log)).resolves.toBe(2);
// });

test("Emits a event to a thread and expects another emitted back with the same arguments", () => {
	const child = Parent<typeof Child>("./lib/child.js");
	const result = new Promise(res => {
		child.on("eventFromChild", (...args) => res(JSON.stringify(args)));
		child.emit("eventFromParent", "Hello World", [1, 2, 3]);
	});
	return expect(result).resolves.toBe(JSON.stringify(["Hello World", [1, 2, 3]])).finally(child.terminate);
});

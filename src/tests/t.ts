import { Parent } from "../";
import type * as ExitThread from "./lib/exit";

const crashingThread = Parent<typeof ExitThread>("./lib/exit");
crashingThread.exited
	.then(() => {
		console.log("exited");
	})
	.catch(() => {
		console.log("errored");
	});
crashingThread.exit(12);
// if (false) (() => {
// 	const child = new Parent(path.join(__dirname, './lib/child.js'), { name: 'child' })

// 	child.on('test', (...args) => {
// 		console.log(`Received ${JSON.stringify(args)} in parent.`)
// 	})
	
// 	setInterval(() => child.emit('test', 'OwO', 'UwU', [1,2,3]), 1000)
// })()

// if (false) (async () => {
// 	const child = new ParentPool(path.join(__dirname, './lib/child.js'), { name: 'child', count: 4 })
// 	setInterval(() => console.log(child.working, child.queued))
// 	Promise.all([
// 		child.add1Slow(3)
// 	]).then(console.log)
// 	child.runQueue()
// 	// process.exit(1)
// })()

// if (true) (async () => {
// 	const child = new ParentPool(path.join(__dirname, './lib/child.js'), { name: 'child', count: 4 })
// 	console.log(child.all.add1(1))
// })()
import { Parent } from "../";

// const crashingThread = Parent("./lib/error");
// crashingThread.exited.catch(() => console.log("errored"));

// setTimeout(() => {
// 	(async () => {
// 		const exitResult = await crashingThread.exited.catch(() => null);
// 		console.log(await crashingThread.terminate());
// 		console.log("Ok done now!");
// 	})();
// }, 1000);
const crashingThread = Parent("./lib/exit");
crashingThread.exited.then(e => console.log("exited", e)).catch(console.log);
(async () => {
	console.log(await crashingThread.terminate());
	console.log("Hello World", crashingThread.exited);
	// crashingThread.exit(12);
	console.log(await crashingThread.exited);
	console.log("Hello World");
})();


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
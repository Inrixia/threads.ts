// const path = require('path')

// let Parent, ParentPool, Thread;

// beforeEach(() => {
// 	Parent, ParentPool, Thread = null
// 	jest.clearAllMocks()
//         .resetModules();
// 	({ Parent, ParentPool, Thread } = require('../index.js'))
// });

// const smolPath = path.join(__dirname, './lib/smol.js')
// const childPath = path.join(__dirname, './lib/child.js')

// test('Adds 1 in child.js', () => {
// 	const child = new Parent(childPath, { name: 'child' })
// 	return expect(child.add1(1)).resolves.toBe(2);
// });

// test('Adds 1 in child.js with depth', () => {
// 	const child = new Parent(childPath, { name: 'child' });
// 	return expect(child.add1Deep(1)).resolves.toBe(2);
// });

// test('Queues and runs two functions', () => {
// 	const child = new Parent(childPath, { name: 'child' })
// 	const expectation = Promise.all([child.queue.return1(), child.queue.return1()])
// 	child.runQueue()
// 	return expect(expectation).resolves.toStrictEqual([1, 1]);
// });

// test('Requires and runs a function in one thread from another', () => {
// 	const child = new Parent(childPath, { name: 'child' })
// 	const smol = new Parent(smolPath, { name: 'smol' })
// 	return expect(child.smol(1)).resolves.toBe(2);
// });

// test('Spawns a ParentPool for child and runs four functions', () => {
// 	const child = new ParentPool(childPath, { name: 'child' })
// 	return expect(Promise.all([child.add1(1), child.add1(1), child.add1(1), child.add1(1)])).resolves.toStrictEqual([2, 2, 2, 2]);
// });

// // test('Requires and runs a function in a thread pool from another', () => {
// // 	const child = new Parent(childPath, { name: 'child' })
// // 	const smol = new ParentPool(smolPath, { name: 'smol' })
// // 	return expect(child.smol(1).catch(console.log)).resolves.toBe(2);
// // });

// test('Emits a event to a thread and expects another emitted back with the same arguments', () => {
// 	const child = new Parent(childPath, { name: 'child' })
// 	const result = new Promise((resolve, reject) => {
// 		child.on('eventFromChild', (...args) => resolve(JSON.stringify(args)))
// 		child.emit('eventFromParent', 'Hello World', [1,2,3])
// 	})
// 	return expect(result).resolves.toBe(JSON.stringify(['Hello World', [1,2,3]]));
// });

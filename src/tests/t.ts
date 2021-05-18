// const path = require('path')
// const { Parent, ParentPool, Thread } = require('../index.js')

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
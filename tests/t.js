const path = require('path')
const { Parent, ParentPool, Thread } = require('../index.js')

if (false) (() => {
	const child = new Parent(path.join(__dirname, './lib/child.js'), { name: 'child' })

	child.on('test', (...args) => {
		console.log(`Received ${JSON.stringify(args)} in parent.`)
	})
	
	setInterval(() => child.emit('test', 'OwO', 'UwU', [1,2,3]), 1000)
})()

if (true) (async () => {
	const child = new ParentPool(path.join(__dirname, './lib/child.js'), { name: 'child', count: 4 })
	console.log(await child.add1(1), await child.add1(2), await child.add1(3))
})()
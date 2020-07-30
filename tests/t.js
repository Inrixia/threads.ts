const path = require('path')
const { Parent, DistributedParent, Thread } = require('../index.js')

const child = new Parent(path.join(__dirname, './lib/child.js'), { name: 'child' })


child.on('test', (...args) => {
	console.log(`Received ${JSON.stringify(args)} in parent.`)
})

setInterval(() => child.emit('test', 'OwO', 'UwU', [1,2,3]), 1000)

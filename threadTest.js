const { Parent, DistributedParent } = require('./lib/Thread.js')


;(async () => {
	const helloWorldThread = new DistributedParent('helloWorld.js', {}, { magicArray: ["Suprise"] })
	console.log('parent tries to call child')
	console.log(await helloWorldThread.helloWorld().catch(console.log))
})().catch(console.log)

module.exports = { test: () => 'Hello Child' }
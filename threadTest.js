const { Parent, DistributedParent } = require('./lib/Thread.js')


;(async () => {
	const helloWorldThread = new Parent('helloWorld.js', {}, {magicArray: ["Suprise"]})
	console.log(await helloWorldThread.helloWorld())
})().catch(console.log)

module.exports = { test: () => 'Hello Child' }
const { Parent, DistributedParent } = require('./lib/Thread.js')


;(async () => {
	const helloWorldThread = new DistributedParent('helloWorld.js')
	console.log(await helloWorldThread.helloWorld())
})().catch(console.log)

module.exports = { test: () => 'Hello Child' }
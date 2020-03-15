const { Parent, DistributedParent } = require('./lib/Thread.js')


;(async () => {
	const helloWorldThread = new Parent('helloWorld.js')
	console.log(await helloWorldThread.helloWorld())
})().catch(console.log)
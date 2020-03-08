const Thread = require('./lib/threads/Thread.js').DistributedParent

const helloWorldParent = async () => "Hello World Parent"

const childThread = new Thread('./childThreadTest.js')

;(async () => {
	console.log(await childThread.helloWorld().catch(console.log))
})()

childThread.helloWorldParent = helloWorldParent
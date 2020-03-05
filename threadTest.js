const Thread = require('./lib/threads/Thread.js')

const helloWorldParent = async () => "Hello World Parent"

const childThread = new Thread('./childThreadTest.js')

;(async () => {
	const promise = childThread.helloWorld()
	//console.log(childThread)
	console.log(promise)
	console.log(await promise)
	console.log(promise)
})()

childThread.exports.helloWorldParent = helloWorldParent
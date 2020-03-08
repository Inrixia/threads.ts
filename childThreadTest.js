const thisThread = require('./lib/threads/Thread.js').Child

const helloWorld = async () => "Hello World"

thisThread.helloWorld = helloWorld

;(async () => {
	console.log(await thisThread.helloWorldParent().catch(console.log))
})()
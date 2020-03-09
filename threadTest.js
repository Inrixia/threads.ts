const Thread = require('./lib/threads/Thread.js').Parent


;(async () => {
	const helloWorldThread = new Thread('./helloWorld.js')
	const logThings = new Thread('./logThings.js')
	setTimeout(() => {
		// logThings.logThings('helo WORLD')
	}, 1000)
})()
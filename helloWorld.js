const thisThread = require('./lib/threads/Thread.js').Child

const helloWorld = async () => "Hello World"

thisThread.helloWorld = helloWorld

;(async () => {
	await thisThread.require('logThings.js')
	await thisThread.parentThreads['logThings.js'].logThings('SUPRISE')
	await thisThread.parentThreads['logThings.js'].logThings('SUNSDF')
	await thisThread.parentThreads['logThings.js'].logThings('MAGIC')
})()
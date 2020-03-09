const thisThread = require('./lib/threads/Thread.js').Child

const helloWorld = async () => "Hello World"

thisThread.exports.helloWorld = helloWorld

;(async () => {
	await thisThread.require('logThings.js')
	await thisThread.threads['logThings.js'].logThings('SUPRISE')
	// await thisThread.threads['logThings.js'].logThings('SUNSDF')
	// await thisThread.threads['logThings.js'].logThings('MAGIC')
})()
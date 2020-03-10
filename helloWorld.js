const thisThread = require('./lib/Thread.js').Child

const helloWorld = async () => "Hello World"

module.exports = { helloWorld }

// ;(async () => {
// 	await thisThread.require('logThings.js')
// 	await thisThread.threads['logThings.js'].logThings('SUPRISE')
// 	// await thisThread.threads['logThings.js'].logThings('SUNSDF')
// 	// await thisThread.threads['logThings.js'].logThings('MAGIC')
// })()
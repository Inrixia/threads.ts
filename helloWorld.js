const { Parent, Child } = require('./lib/Thread.js')

const otherThread = new Parent('./logThings.js')

const helloWorld = async () => {
	console.log(await Child.test())
	// return 'Hello Parent'
	return await otherThread.doubleIt(1)
	// await thread.require('./logThings.js')
	// return `Hello World ${await thread.threads['./logThings.js'].doubleIt(1)}`
}

module.exports = { helloWorld }
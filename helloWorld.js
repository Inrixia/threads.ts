const thread = require('./lib/Thread.js').Child

const helloWorld = async () => {
	console.log('wait require')
	await thread.require('./logThings.js')
	return `Hello World ${await thread.threads['./logThings.js'].doubleIt(1)}`
}

module.exports = { helloWorld }
const Child = require('./lib/Thread.js').Child

console.log(Child.data)

const helloWorld = async () => {
	await Child.require('./logThings.js')
	console.log(await Child.test())
	return `Hello World ${await Child.threads['./logThings.js'].doubleIt(1)}`
}

module.exports = { helloWorld }
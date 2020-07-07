const Child = require('../lib/Thread.js').Child

const helloWorld = async () => {
	console.log('child requires another child')
	await Child.require('./logThings.js')
	console.log('child calls parent')
	console.log(await Child.doubleIt(1))
	console.log('parent responds')
	// return `Hello World ${await Child.threads['./logThings.js'].doubleIt(1)}`
	return id
}

module.exports = { helloWorld }
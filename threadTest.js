const { Parent, DistributedParent } = require('./lib/threads/Thread.js')


;(async () => {
	// const helloWorldThread = new Parent('./helloWorld.js')
	// const logThings = new DistributedParent('./logThings.js')
	// setTimeout(() => {
	// 	logThings.logThings('helo WORLD')
	// }, 1000)

	const helloTest = new DistributedParent(`
		const thisThread = require('./lib/threads/Thread.js').Child

		const helloWorld = async () => "Hello World"
		
		thisThread.exports.helloWorld = helloWorld
	`, { name: 'HelloWorld', eval: true })
	console.log(await helloTest.helloWorld())
})()

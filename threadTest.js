const { Parent, DistributedParent } = require('./lib/Thread.js')


;(async () => {
	// const helloWorldThread = new Parent('./helloWorld.js')
	// const logThings = new DistributedParent('./logThings.js')
	// setTimeout(() => {
	// 	logThings.logThings('helo WORLD')
	// }, 1000)

	// const helloTest = new DistributedParent(`
	// 	const thisThread = require('./lib/Thread.js').Child

	// 	const helloWorld = async () => "Hello World"
		
	// 	thisThread.exports.helloWorld = helloWorld
	// `, { name: 'HelloWorld', eval: true })
	// console.log(await helloTest.helloWorld())



	const exampleDistributedThread = new Parent('./helloWorld.js', { count: 8 })
	console.log(await exampleDistributedThread.helloWorld())
	// let promises = []
	// for (let i = 0; i < 1; i++) promises.push(exampleDistributedThread.queue.helloWorld())
	// console.log(await exampleDistributedThread.runQueue())
	// console.log(await Promise.all(promises))
})()

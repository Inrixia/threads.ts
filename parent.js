const { Parent } = require('./lib/Thread.js')
const child = new Parent('./child.js')

const util = require('util')

;(async() => {
	const res = await child.Magic()
	console.log('RES', res)
})().catch(console.log)

// process.on('unhandledRejection', (reason, p) => {
// 	console.log('UN-TOP', p, 'reason:', reason);
// });
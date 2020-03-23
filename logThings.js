const Child = require('./lib/Thread.js').Child

const doubleIt = async num => {
	console.log('called')
	return num*2
}

module.exports = { doubleIt }
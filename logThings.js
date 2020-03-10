const thisThread = require('./lib/Thread.js').Child

const logThings = async things => {
	console.log(things)
	return 'magical'
}

thisThread.exports.logThings = logThings
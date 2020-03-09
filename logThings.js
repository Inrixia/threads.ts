const thisThread = require('./lib/threads/Thread.js').Child

const logThings = async things => {
	console.log(things)
	return 'magical'
}

thisThread.exports.logThings = logThings
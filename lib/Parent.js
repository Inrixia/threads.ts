const { Worker } = require('worker_threads');
const path = require('path')


const threadPath = path.join(__dirname, './Thread.js').replace(/\\/g, '\\\\')
const Thread = require(threadPath)

const sharedArrayBufferSize = 16

class Parent extends Thread {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {*} data Data to be given to the thread on startup. Exposed as `importName.data` in the Child Thread.
	 */
	constructor(threadInfo, options={}, data=null) {
		const threadTemp = threadInfo
		if (!options.eval) threadInfo = `module.exports = require('${path.resolve(threadInfo).replace(/\\/g, '\\\\')}')`
		if (!options.sharedArrayBuffer) options.sharedArrayBuffer = new SharedArrayBuffer(sharedArrayBufferSize)
		super(
			new Worker(`
				const { parentPort, workerData } = require('worker_threads');
				module.thread = new (require('${threadPath}'))(parentPort, workerData)
				${threadInfo}
			`, { workerData: { sharedArrayBuffer: options.sharedArrayBuffer, data }, eval: true }),
			{  sharedArrayBuffer: options.sharedArrayBuffer },
		)
		Thread.addThread(threadTemp, this)
		this.threadInfo = threadInfo
	}
}

module.exports = Parent
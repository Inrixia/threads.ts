const { Worker } = require('worker_threads');
const path = require('path')


const threadPath = path.join(__dirname, './Thread.js').replace(/\\/g, '\\\\')
const Thread = require(threadPath)

class Parent extends Thread {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {string} [options.name] Name of thread, used for imports from other threads.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {*} data Data to be given to the thread on startup. Exposed as `importName.data` in the Child Thread.
	 */
	constructor(threadInfo, options={}, data=null) {
		let threadImport
		if (!options.eval) threadImport = `module.exports = require('${threadInfo.replace(/\\/g, '\\\\')}')`
		super(
			new Worker(`
				const { parentPort, workerData } = require('worker_threads');
				module.thread = new (require('${threadPath}'))(parentPort, workerData);
				${options.eval?threadInfo:threadImport}
			`, { workerData: { options, data }, eval: true }),
			{  options: { sharedArrayBuffer: options.sharedArrayBuffer } },
		)
		Thread.addThread(options.name||threadInfo, this)
		this.name = options.name
		this.threadInfo = threadInfo
	}
}

module.exports = Parent
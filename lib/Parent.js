const { Worker } = require('worker_threads');
const path = require('path')

const threadPath = path.join(__dirname, './Thread.js').replace(/\\/g, '\\\\')
const Thread = require(threadPath)

class Parent extends Thread {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {*} workerData Data to be given to the thread on startup. 
	 * @param {SharedArrayBuffer} [workerData.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {Object} options Options for spawned thread.
	 * @param {string} [options.name] Name of thread, used for imports from other threads.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 */
	constructor(threadInfo, workerData={}, options={}) {
		let threadImport
		if (!options.eval) threadImport = `module.exports = require('${threadInfo.replace(/\\/g, '\\\\')}')`
		if (!(workerData||{}).sharedArrayBuffer) workerData.sharedArrayBuffer = new SharedArrayBuffer(16)
		super(
			new Worker(`
					const { parentPort, workerData } = require('worker_threads');
					module.thread = new (require('${threadPath}'))(parentPort, workerData);
					${options.eval?threadInfo:threadImport}
				`, 
				{ workerData, eval: true }
			),
			workerData,
			options
		)
		Thread.addThread(options.name||threadInfo, this)
		this.name = options.name
		this.threadInfo = threadInfo
	}
}

module.exports = Parent
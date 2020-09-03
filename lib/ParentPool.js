const { MessageChannel } = require('worker_threads');

const Thread = require('./Thread.js');
const ThreadStore = require('./ThreadStore.js');
const Parent = require('./Parent.js');

class ParentPool extends Thread {
	/**
	 * Spawns a collection of new `childThreads` and returns class to interface them.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {*} workerData Data to be given to the thread on startup. Exposed as `importName.data` in the Child Thread.
	 * @param {SharedArrayBuffer} [workerData.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {Object} options Options for spawned thread.
	 * @param {string} [options.name] Name of thread, used for imports from other threads.
	 * @param {number} [options.count] Number of threads in ParentPool to spawn. Defaults to 2.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 */
	constructor(threadInfo, workerData={}, options={}) {
		if (!(workerData||{}).sharedArrayBuffer) workerData.sharedArrayBuffer = new SharedArrayBuffer(16)
		super(false, workerData)
		if (!options.count) options.count = 2
		if (options.count < 2) throw new Error('options.count must be greater than 0.')

		this._internalFunctions = {
			runQueue: this._runQueue,
			stopExecution:  this.stopExecution, 
		}

		this._subThreads = []
		this._threadSelect = 0;

		Thread.addThread(options.name||threadInfo, this)

		this.randomID = Math.random()
		this.name = options.name
		this.threadInfo = threadInfo

		this.pool = true

		// Spawn parent threads
		for (let i = 0; i < options.count; i++) this._subThreads.push(
			new Parent(threadInfo, workerData, {
				name: `${options.name}_${i}_${this.randomID}`,
				eval: options.eval,
				sharedArrayBuffer: this._sharedArrayBuffer,
			})
		)

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => (...args) => {
				this.queuedFunctions++;
				// Calls on the parent to request the child to run the specified function
				const promise = this._subThreads[this.threadSelect]['_callThreadFunction'](key, args, 'queue')
				promise.then(this._onQueueEnd, this._onQueueEnd)
				return promise
			}
		})
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined && key != 'then') {	
					return (...args) => {
						const promise = this._subThreads[this.threadSelect]['_callThreadFunction'](key, args, 'call')
						return promise
					}
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	get threadSelect() {
		if (this._threadSelect > this._subThreads.length-1) this._threadSelect = 0
		return this._threadSelect++
	}
	set threadSelect(value) {
		throw new Error('Cannot set property "threadSelect" on a ParentPool.')
	}

	/**
	 * Runs thread queues.
	 * @returns {number} functions run.
	 */
	runQueue = async () => await this._forAllThreads('runQueue')
	/**
	 * Stops execution of the function queues.
	 */
	stopExecution = () => this._forAllThreads('stopExecution')

	/**
	 * Calls a function on all threads.
	 * @param {string} func Name of function to call.
	 * @param {*} ...args Arguments to pass to function.
	 */
	_forAllThreads = (func, ...args) => Promise.all(this._subThreads.map(thread => thread[func](...args)))
}

module.exports = ParentPool
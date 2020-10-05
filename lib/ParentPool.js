const { MessageChannel } = require('worker_threads');

const Thread = require('./Thread.js');
const ThreadStore = require('./ThreadStore.js');
const Parent = require('./Parent.js');

class ParentPool extends Thread {
	/**
	 * Spawns a collection of new `childThreads` and returns class to interface them.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {string} [options.name] Name of thread, used for imports from other threads.
	 * @param {number} [options.count] Number of threads in ParentPool to spawn. Defaults to 2.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {*} [options.data] Data to be passed to thread as module.parent.thread.data
	 */
	constructor(threadInfo, options={}) {
		if (!options.sharedArrayBuffer) options.sharedArrayBuffer = new SharedArrayBuffer(16)
		super(false, options)
		if (!options.count) options.count = 4
		if (options.count < 1) options.count = 1

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
			new Parent(threadInfo, {
				name: `${options.name}_${i}_${this.randomID}`,
				eval: options.eval,
				sharedArrayBuffer: this._sharedArrayBuffer,
				data: options.data
			})
		)

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => (...args) => {
				// Calls on the parent to request the child to run the specified function
				const promise = this._subThreads[this.threadSelect]['_callThreadFunction'](key, args, 'queue')
				promise.then(this._onQueueEnd, this._onQueueEnd)
				return promise
			}
		})

		this.all = new Proxy({}, {
			get: (target, key, receiver) => (...args) => this._forAllThreads(key, ...args)
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
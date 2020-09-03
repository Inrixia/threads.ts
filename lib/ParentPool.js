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
	 * @param {*} data Data to be given to the thread on startup. Exposed as `importName.data` in the Child Thread.
	 */
	constructor(threadInfo, options={}, data=null) {
		super()
		if (options.count < 2) throw new Error('options.count must be greater than 0.')
		if (!options.count) options.count = 2
		if (!options.sharedArrayBuffer) this._sharedArrayBuffer = new SharedArrayBuffer(16)
		else this._sharedArrayBuffer = options.sharedArrayBuffer

		// this._threadsWorking = 0;

		this._threadStore = new ThreadStore(this._sharedArrayBuffer)

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
				sharedArrayBuffer: new SharedArrayBuffer(16),
				data
			})
		)

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => (...args) => {
				this.queuedFunctions++;
				const promise = this._subThreads[this.threadSelect].queue['_callThreadFunction'](key, args, 'queue')
				promise.then(this._onQueueEnd, this._onQueueEnd)
				return promise
			}
		})
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined && key != 'then') {	
					return (...args) => {
						// this.working = true;
						const promise = this._subThreads[this.threadSelect]['_callThreadFunction'](key, args, 'call')
						promise.then(this._onCallEnd, this._onCallEnd)
						return promise
					}
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	_onCallEnd = () => {}//this.working = false
	_onQueueEnd = () => this.queuedFunctions--

	get threadSelect() {
		if (this._threadSelect > this._subThreads.length-1) this._threadSelect = 0
		return this._threadSelect++
	}
	set threadSelect(value) {
		throw new Error('Cannot set property "threadSelect" on a ParentPool.')
	}

	// get working() { return this._threadStore.working }
	// set working(value) { 
	// 	if (value === true) {
	// 		this._threadsWorking++
	// 		this._threadStore.working = true
	// 	} else if (value === false) {
	// 		this._threadsWorking--
	// 		if (this._threadsWorking < 0) this._threadsWorking = 0;
	// 		if (this._threadsWorking === 0) this._threadStore.working = false
	// 	} else this._threadStore.working = value
	// }

	get queuedFunctions() { return this._threadStore.queuedFunctions }
	set queuedFunctions(value) { this._threadStore.queuedFunctions = value }

	/**
	 * Runs thread queues.
	 * @returns {number} functions run.
	 */
	runQueue = async () => {
		// this.working = true;
		await this._forAllThreads('runQueue')
		// this.working = false;
	}
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
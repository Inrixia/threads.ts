const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// Wrap around the `module.loaded` param so we only run functions after this module has finished loading
moduleLoaded = new Promise(resolve => {
	module._loaded = module.loaded
	Object.defineProperty(module, 'loaded', {
		get: () => {
			if (module._loaded) resolve(true)
			return module._loaded
		},
		set: value => {
			if (module._loaded) resolve(true)
			module._loaded = value
		}
	});
})

// Shared value
class ThreadStore {
	constructor(sharedArrayBuffer) {
		this._dataview = new DataView(sharedArrayBuffer);
		this.working = false;
		this.queuedFunctions = 0;
	}

	_setBool(byteOffset, value) { 
		if (value === true) this._dataview.setUint8(byteOffset, 1)
		else if (value === false) this._dataview.setUint8(byteOffset, 0)
		else throw new Error(`Property working must be of type boolean. Was ${value}, type ${typeof value}.`)
	}

	_getBool(byteOffset) {
		const bool = this._dataview.getUint8(byteOffset);
		if (bool === 0) return false
		else if (bool === 1) return true
		else throw new Error(`Boolean value retrieved was ${bool}, expected 0 or 1.`)
	}

	set working(value) { this._setBool(0, value) }
	get working() { return this._getBool(0) }

	set queuedFunctions(value) { this._dataview.setInt32(1, value) }
	get queuedFunctions() { return this._dataview.getInt32(1) }
}

class Thread {
	/**
	 * Returns a promise containing a constructed `Thread`.
	 * @param {Worker} messagePort Port the thread will communicate on
	 * @param {Object} workerData Data passed to thread on start
	 * @param {SharedArrayBuffer} workerData.sharedArrayBuffer Shared memory containing thread parameters
	 * @param {Object<string, Function>} localFunctions Functions locally avalible for this thread to execute on call.
	 */
	constructor(messagePort, workerData) {
		this.thread = messagePort
		this._threadStore = new ThreadStore(workerData.sharedArrayBuffer)
		this._promises = {}
		this._functionQueue = []

		this._stopExecution = false

		// Exported public functions
		this.runQueue = async () => await this._executeFunctionQueue()
		this.stopExecution = async () => this._stopExecution = true

		// Create an eventlistener for handling thread events
		this.thread.on('message', async message => {
			// Call to run a local function
			switch (message.type) {
				case 'function':
					this._callSelfFunction(message)
					break;
				case 'resolve':
					this._promises[message.promiseKey].resolve(message.data)
					break;
				case 'reject':
					this._promises[message.promiseKey].reject(message.data)
					break;
				case 'queue':
					this._queueSelfFunction(message)
					break;
			}
		})

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => {
				if (target[key] == undefined) {
					return (data, promiseKey) => this._queueThreadFunction(key, data, promiseKey)
				} else return Reflect.get(target, key, receiver)
			}
		})
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined) {
					return (data, promiseKey) => this._callThreadFunction(key, data, promiseKey)
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	get working() { return this._threadStore.working }
	set working(value) { this._threadStore.working = value }

	get queuedFunctions() { return this._threadStore.queuedFunctions }
	set queuedFunctions(value) { this._threadStore.queuedFunctions = value }

	/**
	 * Queues a function to be executed in the future.
	 * @param {Object} message Object containing function info.
	 * @param {string} message.func Function from `this._functions` to execute.
	 * @param {*} message.data Data passed to `function`.
	 * @param {string|number} message.promiseKey Unique key used for returned promise.
	 */
	_queueSelfFunction(message) {
		this._functionQueue.push(message)
		this.queuedFunctions = this._functionQueue.length
	}
	async _executeFunctionQueue() {
		while (this._functionQueue.length > 0) {
			if (this._stopExecution) break;
			await this._callSelfFunction(this._functionQueue.pop())
			this.queuedFunctions = this._functionQueue.length
		}
		return this._functionQueue.length
	}

	/**
	 * Calls a function defined in this.functions.
	 * @param {Object} message Object containing function info.
	 * @param {string} message.func Function from `this._functions` to execute.
	 * @param {*} message.data Data passed to `function`.
	 * @param {string|number} message.promiseKey Unique key used for returned promise.
	 */
	async _callSelfFunction(message) {
		if (!module.loaded) await moduleLoaded
		if (typeof this[message.func] != 'function') this._rejectPromise(new Error(`${JSON.stringify(message.func)} is ${typeof this[message.func]}.`), message.promiseKey)
		else {
			this.working = true
			await this[message.func](message.data)
			.then(
				resolvedData => this._resolvePromise(resolvedData, message.promiseKey),
				rejectedData => this._rejectPromise(rejectedData, message.promiseKey)
			)
			this.working = false
		}
	}

	_resolvePromise(data, promiseKey) {
		this.thread.postMessage({ 
			type: 'resolve',
			data,
			promiseKey
		})
	}
	_rejectPromise(data, promiseKey) {
		this.thread.postMessage({ 
			type: 'reject',
			data,
			promiseKey
		})
	}

	/**
	 * Queues a thread function.
	 * @param {string} func Key of `function` to execute.
	 * @param {*} data Data to give to the `function`.
	 * @param {number|string} promiseKey Unique key used for returned promise.
	 * 
	 * @returns {Promise} Promise that resolves with function result.
	 */
	_queueThreadFunction(func, data, promiseKey) {
		return this._callThreadFunction(func, data, promiseKey, 'queue')
	}

	/**
	 * Calls a thread function.
	 * @param {string} func Key of `function` to execute.
	 * @param {*} data Data to give to the `function`.
	 * @param {number|string} promiseKey Unique key used for returned promise.
	 * 
	 * @returns {Promise} Promise that resolves with function result.
	 */
	_callThreadFunction(func, data, promiseKey=Math.random(), type='function') {
		let externalPromise = {};
		let promise = new Promise((resolve, reject) => {
			externalPromise.resolve = resolve;
			externalPromise.reject = reject;
		});
		// Store the promise to be resolved externall later
		this._promises[promiseKey] = externalPromise
		// Ask the thread to execute/queue the function
		this.thread.postMessage({ 
			type, 
			func,
			promiseKey,
			data
		})
		// Delete the promise from the cache once its resolved
		promise.then(() => delete this._promises[promiseKey])
		return promise
	}
}

class Parent extends Thread {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadFile File for thread to run.
	 */
	constructor(threadFile) {
		const sharedArrayBuffer = new SharedArrayBuffer(64)
		super(
			new Worker(threadFile, { workerData: { sharedArrayBuffer } }),
			{  sharedArrayBuffer },
		)
	}
}

class DistributedParent {
	/**
	 * Spawns a collection of new `childThreads` and returns class to interface them.
	 * @param {string} threadFile File for thread to run.
	 * @param {number} threadCount Number of threads to spawn.
	 */
	constructor(threadFile, threadCount=2) {
		if (threadCount === 0) throw new Error('threadCount must be greater than 0.')
		this.threads = []
		this._threadSelect = 0;

		// Spawn parent threads
		for (let i = 0; i < threadCount; i++) this.threads.push(new Parent(threadFile))

		// Exported public functions
		this.runQueue = () => this.forAllThreads('runQueue')
		this.stopExecution = () => this.forAllThreads('stopExecution')

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => {
				if (target[key] == undefined) {
					return (data, promiseKey) => this.loadBalance('_queueThreadFunction', key, data, promiseKey)
				} else return Reflect.get(target, key, receiver)
			}
		})
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined) {	
					return (data, promiseKey) => this.loadBalance('_callThreadFunction', key, data, promiseKey)
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	get threadSelect() {
		if (this._threadSelect > this.threads.length-1) this._threadSelect = 0
		return this._threadSelect++
	}
	set threadSelect(value) {
		throw new Error('Cannot set property "threadSelect" on a DistributedParent.')
	}

	/**
	 * Calls a function on all threads.
	 * @param {string} func Name of function to call.
	 * @param {*} ...args Arguments to pass to function.
	 */
	forAllThreads(func, ...args) {
		return Promise.all(this.threads.map(thread => thread[func](...args)))
	}

	/**
	 * Loadbalances function calls across threads.
	 * @param {string} func Name of function to call.
	 * @param {*} ...args Arguments to pass to function.
	 */
	loadBalance(func, ...args) {
		return this.threads[this.threadSelect][func](...args)
	}
	
	get working() { 
		return this.threads.find(thread => thread.working)||false
	}
	set working(value) {
		throw new Error('Cannot set property "working" on a DistributedParent.')
	}

	get queuedFunctions() { 
		return this.threads.reduce((a, b) => a.queuedFunctions+b.queuedFunctions, 0)
	}
	set queuedFunctions(value) {
		throw new Error('Cannot set property "queuedFunctions" on a DistributedParent.')
	}
}

// Export the appropriate module depending on if this is a thread parent or child.
module.exports = new Proxy({ Child: Thread, Parent, DistributedParent }, {
	get: (target, property, receiver) => {
		if (property === 'Child') {
			if (workerData == null) throw new Error('This is not a child thread.')
			else return new Thread(parentPort, workerData)
		} else return Reflect.get(target, property, receiver)
	}
})
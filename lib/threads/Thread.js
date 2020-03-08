const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

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

		// Wrap around the `module.loaded` param so we only run functions after this module has finished loading
		this._loaded = new Promise(resolve => {
			module._loaded = module.loaded
			Object.defineProperty(module, 'loaded', {
				get: () => {
					if (module._loaded) resolve(true)
					return module._loaded
				},
				set: value => module._loaded = value
			});
		})
		

		this.thread = messagePort
		this._threadStore = new ThreadStore(workerData.sharedArrayBuffer)
		this._promises = {}
		this._functionQueue = []

		this._stopExecution = false

		this.queue = new Proxy({}, {
			get: (target, key) => {
				if (target[key] == undefined) {
					return (data, promiseKey) => this._queueThreadFunction(key, data, promiseKey)
				} else return Reflect.get(...arguments);
			}
		})

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

		return new Proxy(this, {
			get: (target, key) => {
				if (target[key] == undefined) {
					return (data, promiseKey) => this._callThreadFunction(key, data, promiseKey)
				} else return Reflect.get(...arguments);
			}
		})
	}

	get working() { return this._threadStore.working }
	set working(value) { this._threadStore.working = value }

	get queuedFunctions() { return this._threadStore.queuedFunctions }
	set queuedFunctions(value) { this._threadStore.queuedFunctions = value }

	set functions(functions) { this._functions = { ...this._functions, ...functions }}
	get functions() { return this._functions }

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
		await this._loaded
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

// Export the appropriate module depending on if this is a thread parent or child.
if (isMainThread) module.exports = Parent
else module.exports = new Thread(parentPort, workerData)
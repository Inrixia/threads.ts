const { Worker, isMainThread, parentPort, workerData, MessageChannel } = require('worker_threads');
const path = require('path')

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

let spawnedThreads = {}

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
	 */
	constructor(messagePort, workerData) {
		this.thread = messagePort

		this._threadStore = new ThreadStore(workerData.sharedArrayBuffer)
		this._workerData = workerData
		this._promises = {}
		this._functionQueue = []

		this._stopExecution = false
		this.threads = {}

		this._exports = { 
			runQueue: this.runQueue, 
			stopExecution:  this.stopExecution, 
			require: this.require, 
			_getThreadReferenceData: this._getThreadReferenceData
		}

		Object.defineProperty(this, 'exports', {
			get: () => this._exports,
			set: value => this._exports = { ...value, ...this._exports }
		})

		

		// Create an eventlistener for handling thread events
		this.thread.on('message', this._messageHandler(this.thread))

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => (data, promiseKey) => this._callThreadFunction(key, data, promiseKey, 'queue')
		})

		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined && key != 'then') {
					return (data, promiseKey) => this._callThreadFunction(key, data, promiseKey)
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	//
	// Exported functions
	//

	/**
	 * Stops execution of the function queue.
	 */
	stopExecution = async () => this._stopExecution = true

	/**
	 * Imports a reference to a running thread by its threadName,
	 * @example // To load a reference to the thread running file `./somepath/helloWorld.js`
	 * const helloWorldThread = thisThread.require('helloWorld.js')
	 * thisThread.threads['helloWorld.js'] // Also set to the thread reference for non async access
	 */
	require = async threadName => {
		if (this.threads[threadName] == undefined) {
			const threadResources = await this._callThreadFunction('_getThreadReferenceData', threadName)
			this.threads[threadName] = new Thread(threadResources.messagePort, threadResources.workerData)	
		}
		return this.threads[threadName]
	}

	/**
	 * Creates a new `messagePort` for xThread communication, handled by `_messageHandler`.
	 * Returns the new `messagePort` and this threads `workerData`.
	 * @returns {{MessagePort: MessagePort, workerData:{sharedArrayBuffer:SharedArrayBuffer} Transfers: [MessagePort]}} Object containing data needed to reference this thread.
	 */
	_getThreadReferenceData = async threadName => {
		if (spawnedThreads[threadName].constructor == DistributedParent) return await spawnedThreads[threadName]._getThreadReferenceData()
		if (isMainThread) return await spawnedThreads[threadName]._callThreadFunction('_getThreadReferenceData')
		const { port1, port2 } = new MessageChannel();
		port2.on('message', this._messageHandler(port2))
		return { messagePort: port1, workerData, transfers: [port1] }
	}

	//
	// Thread parameters
	//

	get working() { return this._threadStore.working }
	set working(value) { this._threadStore.working = value }

	get queuedFunctions() { return this._threadStore.queuedFunctions }
	set queuedFunctions(value) { this._threadStore.queuedFunctions = value }

	//
	// Thread queue functions
	//

	/**
	 * Queues a function to be executed in the future.
	 * @param {Object} message Object containing function info.
	 * @param {string} message.func Function from `this._functions` to execute.
	 * @param {*} message.data Data passed to `function`.
	 * @param {string|number} message.promiseKey Unique key used for returned promise.
	 */
	_queueSelfFunction = (message, messagePort) => {
		this._functionQueue.push({ func: this._functionHandler(messagePort), message })
		this.queuedFunctions = this._functionQueue.length
	}
	
	/**
	 * Runs thread queue.
	 * @returns {number} length of queue after execution.
	 */
	runQueue = async () => {
		while (this._functionQueue.length > 0) {
			if (this._stopExecution) break;
			const info = this._functionQueue.pop()
			await (info.func(info.message))
			this.queuedFunctions = this._functionQueue.length
		}
		return this._functionQueue.length
	}

	//
	// Thread call handling
	//

	/**
	 * Handler function for thread communication.
	 * @param {Object} message
	 * @param {string} message.type
	 */
	_messageHandler = messagePort => async message => {
		const functionHandler = this._functionHandler(messagePort)
		// Call to run a local function
		switch (message.type) {
			case 'function':
				functionHandler(message)
				break;
			case 'resolve':
				this._promises[message.promiseKey].resolve(message.data)
				break;
			case 'reject':
				this._promises[message.promiseKey].reject(message.data)
				break;
		}
	}

	/**
	 * Returns a function for handling xThread funciton calls.
	 * @param {MessagePort} messagePort the port calls are handled over.
	 * @returns {function({func:string, data, promiseKey:string|number}):void} xThread function handler.
	 */
	_functionHandler = messagePort => async message => {
		if (!module.loaded) await moduleLoaded
		if (typeof this.exports[message.func] != 'function') messagePort.postMessage({ 
			type: 'reject',
			data: new Error(`${JSON.stringify(message.func)} is ${typeof this.exports[message.func]}.`),
			promiseKey: message.promiseKey
		})
		else {
			this.working = true
			await this.exports[message.func](message.data)
			.then(
				data => messagePort.postMessage({ 
					type: 'resolve',
					data,
					promiseKey: message.promiseKey
				}, (data||{}).transfers||[]),
				data => messagePort.postMessage({ 
					type: 'reject',
					data,
					promiseKey: message.promiseKey
				}, (data||{}).transfers||[])
			)
			this.working = false
		}
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
		// Store the resolve/reject functions in this._promises
		const promise = new Promise((resolve, reject) => this._promises[promiseKey] = { resolve, reject });
		// Ask the thread to execute/queue the function
		this.thread.postMessage({
			type, 
			func,
			data,
			promiseKey			
		}, ((data||{}).transfers||[]))
		// Delete the promise from the cache once its resolved
		promise.then(() => delete this._promises[promiseKey])
		return promise
	}
}

class Parent extends Thread {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadInfo File or string code for thread to run.
	 * @param {Object} options
	 * @param {string} [options.name] Name of thread, defaults to threadFile filename if undefined.
	 * @param {bool} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 */
	constructor(threadInfo, options) {
		if (!options.name) options.name = path.basename(threadInfo)
		if (options.eval && !options.name) throw new Error('threadName must be given if spawning off evaluated code.')
		const sharedArrayBuffer = new SharedArrayBuffer(64)
		super(
			new Worker(threadInfo, { workerData: { sharedArrayBuffer }, eval: options.eval }),
			{  sharedArrayBuffer },
		)
		spawnedThreads[options.name] = this
	}
}

class DistributedParent {
	/**
	 * Spawns a collection of new `childThreads` and returns class to interface them.
	 * @param {string} threadInfo File for thread to run.
	 * @param {Object} options
	 * @param {string} [options.name] Name of thread, defaults to threadFile filename if undefined.
	 * @param {number} [options.count] Number of threads in DistributedParent to spawn. Defaults to 2.
	 * @param {bool} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 */
	constructor(threadInfo, options) {
		if (!options.name) options.name = path.basename(threadInfo)
		if (!options.count) options.count = 2
		if (options.count === 0) throw new Error('options.count must be greater than 0.')

		this.threads = []
		this._threadSelect = 0;

		// Spawn parent threads
		for (let i = 0; i < options.count; i++) this.threads.push(new Parent(threadInfo, options))
		spawnedThreads[options.name] = this

		this.exports = {
			runQueue: this.runQueue,
			stopExecution: this.stopExecution
		}

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => (data, promiseKey) => this._loadBalance('_queueThreadFunction', key, data, promiseKey)
		})
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined && key != 'then') {	
					return (data, promiseKey) => this._loadBalance('_callThreadFunction', key, data, promiseKey)
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
	 * Handler function for thread communication.
	 * @param {Object} message
	 * @param {string} message.type
	 */
	_messageHandler = messagePort => async message => {
		// Call to run a local function
		switch (message.type) {
			case 'function':
				await this._loadBalance(message.func, message.data)
				.then(
					data => messagePort.postMessage({ 
						type: 'resolve',
						data,
						promiseKey: message.promiseKey
					}, (data||{}).transfers||[]),
					data => messagePort.postMessage({ 
						type: 'reject',
						data,
						promiseKey: message.promiseKey
					}, (data||{}).transfers||[])
				)
				break;
			case 'resolve':
				this._promises[message.promiseKey].resolve(message.data)
				break;
			case 'reject':
				this._promises[message.promiseKey].reject(message.data)
				break;
		}
	}

	/**
	 * Creates a new `messagePort` for xThread communication, handled by `_messageHandler`.
	 * Returns the new `messagePort` and this threads `workerData`.
	 * @returns {{MessagePort: MessagePort, workerData:{sharedArrayBuffer:SharedArrayBuffer} Transfers: [MessagePort]}} Object containing data needed to reference this thread.
	 */
	_getThreadReferenceData = async threadName => {
		const { port1, port2 } = new MessageChannel();
		port2.on('message', this._messageHandler(port2))
		return { messagePort: port1, workerData: { sharedArrayBuffer: new SharedArrayBuffer(64) }, transfers: [port1] }
	}
	/**
	 * Runs thread queues.
	 * @returns {number} length of queues after execution.
	 */
	runQueue = () => this._forAllThreads('runQueue').reduce((a, b) => a+b)
	/**
	 * Stops execution of the function queues.
	 */
	stopExecution = () => this._forAllThreads('stopExecution')

	/**
	 * Calls a function on all threads.
	 * @param {string} func Name of function to call.
	 * @param {*} ...args Arguments to pass to function.
	 */
	_forAllThreads = (func, ...args) => Promise.all(this.threads.map(thread => thread[func](...args)))

	/**
	 * Loadbalances function calls across threads.
	 * @param {string} func Name of function to call.
	 * @param {*} ...args Arguments to pass to function.
	 * @return {Promise}
	 */
	_loadBalance = (func, ...args) => this.threads[this.threadSelect][func](...args)
	
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
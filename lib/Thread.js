const { Worker, isMainThread, parentPort, workerData, MessageChannel } = require('worker_threads');
const path = require('path')

const sharedArrayBufferSize = 16

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
	}

	_setBool(byteOffset, value) { 
		if (value === true) this._dataview.setUint8(byteOffset, 1)
		else if (value === false) this._dataview.setUint8(byteOffset, 0)
		else throw new Error(`Property must be of type boolean. Was ${value}, type ${typeof value}.`)
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
		if (messagePort == null && workerData == null) return this
		this.thread = messagePort

		this._threadStore = new ThreadStore(workerData.sharedArrayBuffer)
		this._workerData = workerData
		this._promises = {}
		this._functionQueue = []

		this._stopExecution = false

		this.threads = {}
		this._internalFunctions = {
			runQueue: this._runQueue, 
			stopExecution:  this.stopExecution, 
			require: this.require, 
			_getThreadReferenceData: this._getThreadReferenceData
		}

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
	require = async threadFile => {
		if (this.threads[threadFile] == undefined) {
			const threadResources = await this._callThreadFunction('_getThreadReferenceData', path.join(module.parent.path, threadFile))
			this.threads[threadFile] = new Thread(threadResources.messagePort, threadResources.workerData)
		}
		return this.threads[threadFile]
	}

	/**
	 * Creates a new `messagePort` for xThread communication, handled by `_messageHandler`.
	 * Returns the new `messagePort` and this threads `workerData`.
	 * @returns {{MessagePort: MessagePort, workerData:{sharedArrayBuffer:SharedArrayBuffer} Transfers: [MessagePort]}} Object containing data needed to reference this thread.
	 */
	_getThreadReferenceData = async threadFile => {
		if (isMainThread) {
			if (spawnedThreads[threadFile] == undefined) spawnedThreads[threadFile] = new Parent(threadFile)
			
			if (spawnedThreads[threadFile].constructor == DistributedParent) return await spawnedThreads[threadFile]._getThreadReferenceData()
			else return await spawnedThreads[threadFile]._callThreadFunction('_getThreadReferenceData')
		}
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
		this.queuedFunctions++
	}
	
	/**
	 * Runs thread queue.
	 * @returns {number} functions run.
	 */
	_runQueue = async () => {
		let functionsRun = 0;
		while (this._functionQueue.length > 0) {
			if (this._stopExecution) break;
			const info = this._functionQueue.pop()
			this.queuedFunctions--
			await (info.func(info.message))
			functionsRun++
		}
		return functionsRun
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
			case 'call':
				functionHandler(message)
				break;
			case 'resolve':
				this._promises[message.promiseKey].resolve(message.data)
				break;
			case 'reject':
				this._promises[message.promiseKey].reject(message.data)
				break;
			case 'queue':
				this._queueSelfFunction(message, messagePort)
		}
	}

	/**
	 * Returns a function for handling xThread funciton calls.
	 * @param {MessagePort} messagePort the port calls are handled over.
	 * @returns {function({func:string, data, promiseKey:string|number}):void} xThread function handler.
	 */
	_functionHandler = messagePort => async message => {
		if (!module.loaded) await moduleLoaded
		let theFunction;
		if (module.parent.exports[message.func] != undefined) theFunction = module.parent.exports[message.func]
		else if (this._internalFunctions[message.func] != undefined) theFunction = this._internalFunctions[message.func]

		if (typeof theFunction != 'function') messagePort.postMessage({ 
			type: 'reject',
			data: new Error(`Cannot run function in thread. Function ${JSON.stringify(message.func)} is ${typeof theFunction}.`),
			promiseKey: message.promiseKey
		})
		else {
			let funcToExec
			if (theFunction.constructor.name !== "AsyncFunction") funcToExec = async (...args) => theFunction(...args)
			else funcToExec = theFunction
			this.working = true
			await funcToExec(message.data)
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
	_callThreadFunction(func, data, promiseKey=Math.random(), type='call') {
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
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 */
	constructor(threadInfo, options={}) {
		if (!options.eval) threadInfo = path.resolve(threadInfo)
		if (!options.sharedArrayBuffer) options.sharedArrayBuffer = new SharedArrayBuffer(sharedArrayBufferSize)
		super(
			new Worker(threadInfo, { workerData: { sharedArrayBuffer: options.sharedArrayBuffer }, eval: options.eval }),
			{  sharedArrayBuffer: options.sharedArrayBuffer },
		)
		spawnedThreads[options.name] = this
	}
}

class DistributedParent extends Thread {
	/**
	 * Spawns a collection of new `childThreads` and returns class to interface them.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {number} [options.count] Number of threads in DistributedParent to spawn. Defaults to 2.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 */
	constructor(threadInfo, options={}) {
		if (options.count === 0) throw new Error('options.count must be greater than 0.')
		if (!options.count) options.count = 2
		if (!options.sharedArrayBuffer) options.sharedArrayBuffer = new SharedArrayBuffer(sharedArrayBufferSize)

		super()

		this._threadsWorking = 0;

		this._sharedArrayBuffer = options.sharedArrayBuffer
		this._threadStore = new ThreadStore(options.sharedArrayBuffer)

		this.threads = []
		this._threadSelect = 0;

		// Spawn parent threads
		for (let i = 0; i < options.count; i++) this.threads.push(new Parent(threadInfo, {
			eval: options.eval,
			sharedArrayBuffer: new SharedArrayBuffer(sharedArrayBufferSize)
		}))
		spawnedThreads[options.name] = this

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key, receiver) => (data, promiseKey) => {
				this.queuedFunctions++;
				const promise = this.threads[this.threadSelect].queue['_callThreadFunction'](key, data, promiseKey, 'queue')
				promise.then(this._onQueueEnd, this._onQueueEnd)
				return promise
			}
		})
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] == undefined && key != 'then') {	
					return (data, promiseKey) => {
						this.working = true;
						const promise = this.threads[this.threadSelect]['_callThreadFunction'](key, data, promiseKey, 'call')
						promise.then(this._onCallEnd, this._onCallEnd)
						return promise
					}
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	_onCallEnd = () => this.working = false
	_onQueueEnd = () => this.queuedFunctions--

	get threadSelect() {
		if (this._threadSelect > this.threads.length-1) this._threadSelect = 0
		return this._threadSelect++
	}
	set threadSelect(value) {
		throw new Error('Cannot set property "threadSelect" on a DistributedParent.')
	}

	get working() { return this._threadStore.working }
	set working(value) { 
		if (value === true) {
			this._threadsWorking++
			this._threadStore.working = true
		} else if (value === false) {
			this._threadsWorking--
			if (this._threadsWorking < 0) this._threadsWorking = 0;
			if (this._threadsWorking === 0) this._threadStore.working = false
		} else this._threadStore.working = value
	}

	get queuedFunctions() { return this._threadStore.queuedFunctions }
	set queuedFunctions(value) { this._threadStore.queuedFunctions = value }

	/**
	 * Creates a new `messagePort` for xThread communication, handled by `_messageHandler`.
	 * Returns the new `messagePort` and this threads `workerData`.
	 * @returns {{MessagePort: MessagePort, workerData:{sharedArrayBuffer:SharedArrayBuffer} Transfers: [MessagePort]}} Object containing data needed to reference this thread.
	 */
	_getThreadReferenceData = async threadName => {
		const { port1, port2 } = new MessageChannel();
		port2.on('message', this._messageHandler(port2))
		return { messagePort: port1, workerData: { sharedArrayBuffer: this._sharedArrayBuffer }, transfers: [port1] }
	}
	/**
	 * Runs thread queues.
	 * @returns {number} functions run.
	 */
	runQueue = () => this._forAllThreads('runQueue')
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
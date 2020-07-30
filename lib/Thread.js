const { isMainThread, workerData, MessageChannel } = require('worker_threads');
const path = require('path');

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
	/**
	 * Takes a `sharedArrayBuffer` and returns a `ThreadStore` that can set and get the values from it.
	 * @param {SharedArrayBuffer} sharedArrayBuffer Shared memory that another ThreadStore is using.
	 */
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

	set working(value) { this.setInt32(0, value) }
	get working() { return this.setInt32(0) }

	set queuedFunctions(value) { this._dataview.setInt32(1, value) }
	get queuedFunctions() { return this._dataview.getInt32(1) }
}
class Thread extends require('events') {
	/**
	 * Returns a promise containing a constructed `Thread`.
	 * @param {Worker} messagePort Port the thread will communicate on
	 * @param {Object} workerData Data passed to thread on start
	 * @param {SharedArrayBuffer} workerData.sharedArrayBuffer Shared memory containing thread parameters
	 */
	constructor(messagePort, workerData) {
		super()
		if (messagePort == null && workerData == null) return this
		this.thread = messagePort

		if (!workerData.options.sharedArrayBuffer) this._sharedArrayBuffer = new SharedArrayBuffer(16)
		else this._sharedArrayBuffer = workerData.options.sharedArrayBuffer

		this._threadStore = new ThreadStore(this._sharedArrayBuffer)

		this.data = workerData.data||null

		this._promises = {}
		this._promiseKey = 0
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
			get: (target, key, receiver) => data => this._callThreadFunction(key, data, 'queue')
		})

		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] === undefined && key != 'then') {
					return data => this._callThreadFunction(key, data)
				} else return Reflect.get(target, key, receiver)
			}
		})
	}

	//
	// Event Functions
	//
	emit = (eventName, ...args) => {
		super.emit(eventName, ...args)
		this.thread.postMessage({ type: 'event', eventName, args })
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
		if (Thread.spawnedThreads[threadName] != undefined) return await Thread.spawnedThreads[threadName][0]._callThreadFunction('_getThreadReferenceData')
		if (isMainThread && Thread.spawnedThreads[threadName] == undefined) {
			throw new Error(`Thread ${threadName} has not been spawned! Spawned Threads: ${JSON.stringify(Object.keys(Thread.spawnedThreads))}`)
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
	_queueSelfFunction = async (message, messagePort) => {
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
	_messageHandler = messagePort => {
		const functionHandler = this._functionHandler(messagePort)
		return message => {
			// Call to run a local function
			switch (message.type) {
				case 'call':
					functionHandler(message).catch(data => messagePort.postMessage({
						type: 'reject',
						data,
						promiseKey: message.promiseKey
					}))
					break;
				case 'resolve':
					this._promises[message.promiseKey].resolve(message.data)
					delete this._promises[message.promiseKey]
					break;
				case 'reject':
					if ((message.data||{})['stack']) { // Build a special stacktrace that contains all thread info
						message.data['stack'] = message.data['stack'].replace(/\[worker eval\]/g, this.threadInfo)
					}
					this._promises[message.promiseKey].reject(message.data)
					delete this._promises[message.promiseKey]
					break;
				case 'event':
					super.emit(message.eventName, ...message.args)
					break;
				case 'queue':
					this._queueSelfFunction(message, messagePort).catch(data => messagePort.postMessage({ 
						type: 'reject',
						data,
						promiseKey: message.promiseKey
					}))
					break;
			}
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
		else throw new Error(`Cannot run function in thread. Function ${JSON.stringify(message.func)} is ${typeof theFunction}.`)
		let funcToExec
		if (theFunction.constructor.name !== "AsyncFunction") funcToExec = async (...args) => theFunction(...args)
		else funcToExec = theFunction
		// this.working = true
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
		// this.working = false
	}

	/**
	 * Calls a thread function.
	 * @param {string} func Key of `function` to execute.
	 * @param {*} data Data to give to the `function`.
	 * @param {number|string} promiseKey Unique key used for returned promise.
	 * 
	 * @returns {Promise} Promise that resolves with function result.
	 */
	_callThreadFunction(func, data, type='call') {
		const promiseKey = this._promiseKey++
		// Store the resolve/reject functions in this._promises
		const thisStack = new Error().stack
		const promise = new Promise((resolve, reject) => this._promises[promiseKey] = { 
			resolve, 
			reject: err => {
				if (err.stack) err.stack += '\n'+thisStack.replace('Error\n', '')
				reject(err)
			}
		});
		// Ask the thread to execute/queue the function
		this.thread.postMessage({
			type, 
			func,
			data,
			promiseKey			
		}, ((data||{}).transfers||[]))
		// Delete the promise from the cache once its resolved
		return promise
	}
}

Thread.spawnedThreads = {}
Thread.addThread = (threadName, thread) => {
	if (Thread.spawnedThreads[threadName] == undefined) Thread.spawnedThreads[threadName] = [ thread ]
	// else Thread.spawnedThreads[threadName].push(thread)
}

// Export the appropriate module depending on if this is a thread parent or child.
module.exports = Thread
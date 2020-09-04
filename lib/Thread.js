const { isMainThread, workerData, MessageChannel } = require('worker_threads');
const ThreadStore = require('./ThreadStore.js');

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

class Thread extends require('events') {
	/**
	 * Returns a promise containing a constructed `Thread`.
	 * @param {Worker} messagePort Port the thread will communicate on
	 * @param {Object} options Data passed to thread on start
	 * @param {SharedArrayBuffer} options.sharedArrayBuffer Shared memory containing thread parameters
	 */
	constructor(messagePort, options) {
		super()
		this._threadStore = new ThreadStore(options.sharedArrayBuffer)
		if (messagePort == false) return this

		this.thread = messagePort

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
			get: (target, key, receiver) => (...args) => this._callThreadFunction(key, args, 'queue')
		})

		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (target[key] === undefined && key != 'then') {
					return (...args) => this._callThreadFunction(key, args)
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
			const threadResources = await this._callThreadFunction('_getThreadReferenceData', [threadName])
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
		if (Thread.spawnedThreads[threadName] != undefined) return await Thread.spawnedThreads[threadName][0]._callThreadFunction('_getThreadReferenceData', [])
		if (isMainThread && Thread.spawnedThreads[threadName] == undefined) {
			throw new Error(`Thread ${threadName} has not been spawned! Spawned Threads: ${JSON.stringify(Object.keys(Thread.spawnedThreads))}`)
		}
		const { port1, port2 } = new MessageChannel();
		port2.on('message', this._messageHandler(port2))
		return { messagePort: port1, workerData, transfers: [port1] }
	}

	//
	// Thread shared data
	//

	get working() { return this._threadStore.working }
	set working(value) { this._threadStore.working = value }

	get queued() { return this._threadStore.queued }
	set queued(value) { this._threadStore.queued = value }

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
	_queueSelfFunction = async (message, functionHandler) => {
		this._functionQueue.push({ functionHandler, message })
		this.queued++
	}
	
	/**
	 * Runs thread queue.
	 * @returns {number} functions run.
	 */
	_runQueue = async () => {
		if (this._functionQueue.length === 0) return 0
		let functionsRun = 0;
		while (this._functionQueue.length > 0) {
			if (this._stopExecution) break;
			const info = this._functionQueue.pop()
			this.queued--
			await (info.functionHandler(info.message))
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
					this._queueSelfFunction(message, functionHandler).catch(data => messagePort.postMessage({ 
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
		let theFunction, funcToExec;

		if (!module.loaded) await moduleLoaded

		if (module.parent.exports[message.func] != undefined) theFunction = module.parent.exports[message.func]
		else if (this._internalFunctions[message.func] != undefined) theFunction = this._internalFunctions[message.func]
		else throw new Error(`Cannot run function in thread [${this.name}:${this.threadInfo}]. Function ${JSON.stringify(message.func)} is ${typeof theFunction}. `)

		if (theFunction.constructor.name !== "AsyncFunction") funcToExec = async (...args) => theFunction(...args)
		else funcToExec = theFunction
		this.working++
		await funcToExec(...message.data)
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
		this.working--
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
		if (this._promises[promiseKey] != undefined) throw new Error('Duplicate promise key!')
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
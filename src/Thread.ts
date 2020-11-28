import { isMainThread, workerData, MessageChannel, MessagePort, Worker } from "worker_threads";
import ThreadStore from "./ThreadStore";

import type { UnknownFunction, ThreadInfo, ThreadOptions, Messages, InternalFunctions } from "./Types";

// Wrap around the `module.loaded` param so we only run functions after this module has finished loading
let _moduleLoaded = false;
const moduleLoaded: Promise<boolean> = new Promise(resolve => {
	_moduleLoaded = module.loaded;
	Object.defineProperty(module, "loaded", {
		get: () => {
			if (_moduleLoaded) resolve(true);
			return _moduleLoaded;
		},
		set: value => {
			if (_moduleLoaded) resolve(true);
			_moduleLoaded = value;
		}
	});
});

import { EventEmitter } from "events";

type FunctionHandler = (message: Messages.Call | Messages.Queue) => Promise<void>

export default class Thread<D> extends EventEmitter {
	private _options: ThreadOptions<D>;
	private _threadStore: ThreadStore;
	private messagePort?: MessagePort | Worker;
	public data?: D;

	private _promises: { 
		[key: string]: { 
			resolve: (value: unknown) => void, 
			reject: (reason: Error) => void 
		}
	}
	private _promiseKey: number;
	private _functionQueue: Array<{
		functionHandler: FunctionHandler
		message: Messages.Call | Messages.Queue
	}>

	private _stopExecution: boolean

	public importedThreads: { 
		[key: string]: Thread<unknown>
	}

	private _internalFunctions?: InternalFunctions.Type

	public queue?: { 
		[key: string]: UnknownFunction 
	};

	[key: string]: unknown 

	public static spawnedThreads: { 
		[key: string]: Array<Thread<unknown>>
	}

	/**
	 * Returns a promise containing a constructed `Thread`.
	 * @param {MessagePort} messagePort Port the thread will communicate on
	 * @param {Object} options Data passed to thread on start
	 * @param {SharedArrayBuffer} options.sharedArrayBuffer Shared memory containing thread parameters
	 */
	constructor(messagePort: Worker | MessagePort | false, options: ThreadOptions<D>) {
		super();
		this._threadStore = new ThreadStore(options.sharedArrayBuffer);
		this.importedThreads = {};

		this.data = options.data;
		this._options = options;

		this._promises = {};
		this._promiseKey = 0;
		this._functionQueue = [];

		this._stopExecution = false;
		
		if (messagePort === false) return this;
		this.messagePort = messagePort;
		
		this._internalFunctions = {
			runQueue: this._runQueue, 
			stopExecution:  this.stopExecution, 
			require: this.require, 
			_getThreadReferenceData: this._getThreadReferenceData
		};

		// Create an eventlistener for handling thread events
		this.messagePort.on("message", this._messageHandler(this.messagePort));

		// Proxy this and the queue so any function calls are translated to thread calls
		this.queue = new Proxy({}, {
			get: (target, key: string) => (...args: Array<unknown>) => this._callThreadFunction(key, args, "queue")
		});

		return new Proxy(this, {
			get: (target, key: string, receiver) => {
				if (target[key] === undefined && key !== "then") {
					return (...args: Array<unknown>) => this._callThreadFunction(key, args);
				} else return Reflect.get(target, key, receiver);
			}
		});
	}

	static addThread = (threadName: string, thread: Thread<unknown>): void => {
		if (Thread.spawnedThreads[threadName] == undefined) Thread.spawnedThreads[threadName] = [ thread ];
		// else Thread.spawnedThreads[threadName].push(thread)
	}

	//
	// Event Functions
	//
	emit = (eventName: string, ...args: Array<unknown>): boolean => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.messagePort!.postMessage({ type: "event", eventName, args });
		return super.emit(eventName, ...args);
	}

	//
	// Exported functions
	//

	/**
	 * Stops execution of the function queue.
	 */
	stopExecution: InternalFunctions.StopExecution = async (): Promise<boolean> => this._stopExecution = true

	/**
	 * Imports a reference to a running thread by its threadName,
	 * @example // To load a reference to the thread running file `./somepath/helloWorld.js`
	 * const helloWorldThread = thisThread.require('helloWorld.js')
	 * thisThread.threads['helloWorld.js'] // Also set to the thread reference for non async access
	 */
	require: InternalFunctions.Require = async <T extends Thread<D>>(threadName: string): Promise<T> => {
		if (this.importedThreads[threadName] == undefined) {
			const threadResources = await this._callThreadFunction("_getThreadReferenceData", [threadName]) as ThreadInfo;
			this.importedThreads[threadName] = new Thread(threadResources.messagePort, threadResources.workerData);
		}
		return this.importedThreads[threadName] as T;
	}

	/**
	 * Creates a new `messagePort` for xThread communication, handled by `_messageHandler`.
	 * Returns the new `messagePort` and this threads `workerData`.
	 * @returns {{MessagePort: MessagePort, workerData:{sharedArrayBuffer:SharedArrayBuffer} Transfers: [MessagePort]}} Object containing data needed to reference this thread.
	 */
	_getThreadReferenceData: InternalFunctions.GetThreadReferenceData = async (threadName: string): Promise<ThreadInfo> => {
		if (Thread.spawnedThreads[threadName] !== undefined) return await Thread.spawnedThreads[threadName][0]._callThreadFunction("_getThreadReferenceData", []) as ThreadInfo;
		if (isMainThread && Thread.spawnedThreads[threadName] == undefined) {
			throw new Error(`Thread ${threadName} has not been spawned! Spawned Threads: ${JSON.stringify(Object.keys(Thread.spawnedThreads))}`);
		}
		const { port1, port2 } = new MessageChannel();
		port2.on("message", this._messageHandler(port2));
		return { messagePort: port1, workerData, transfers: [port1] };
	}

	//
	// Thread shared data
	//

	get working(): number { return this._threadStore.working; }
	set working(value: number) { this._threadStore.working = value; }

	get queued(): number { return this._threadStore.queued; }
	set queued(value: number) { this._threadStore.queued = value; }

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
	_queueSelfFunction = async (message: Messages.Queue | Messages.Call, functionHandler: FunctionHandler): Promise<void> => {
		this._functionQueue.push({ functionHandler, message });
		this.queued++;
	}
	
	/**
	 * Runs thread queue.
	 * @returns {Promise<number>} functions run.
	 */
	_runQueue: InternalFunctions.RunQueue = async (): Promise<number> => {
		if (this._functionQueue.length === 0) return 0;
		let functionsRun = 0;
		while (this._functionQueue.length > 0) {
			if (this._stopExecution) break;
			const info = this._functionQueue.pop();
			this.queued--;
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			await (info!.functionHandler(info!.message));
			functionsRun++;
		}
		return functionsRun;
	}

	//
	// Thread call handling
	//

	/**
	 * Handler function for thread communication.
	 * @param {Object} message
	 * @param {string} message.type
	 */
	_messageHandler = (messagePort: MessagePort | Worker): (message: Messages.AnyMessage) => void => {
		const functionHandler = this._functionHandler(messagePort);
		return (message: Messages.AnyMessage) => {
			// Call to run a local function
			switch (message.type) {
			case "call":
				functionHandler(message).catch((data: Error) => messagePort.postMessage({
					type: "reject",
					data,
					promiseKey: message.promiseKey
				} as Messages.Reject));
				break;
			case "resolve":
				this._promises[message.promiseKey].resolve(message.data);
				delete this._promises[message.promiseKey];
				break;
			case "reject":
				if (message.data?.stack) { // Build a special stacktrace that contains all thread info
					message.data.stack = message.data.stack.replace(/\[worker eval\]/g, this._options.threadInfo as string);
				}
				this._promises[message.promiseKey].reject(message.data);
				delete this._promises[message.promiseKey];
				break;
			case "event":
				super.emit(message.eventName, ...message.args);
				break;
			case "queue":
				this._queueSelfFunction(message, functionHandler).catch((data: Error) => messagePort.postMessage({ 
					type: "reject",
					data,
					promiseKey: message.promiseKey
				} as Messages.Reject));
				break;
			}
		};
	}

	/**
	 * Returns a function for handling xThread funciton calls.
	 * @param messagePort the port calls are handled over.
	 * @returns xThread function handler.
	 */
	_functionHandler = (messagePort: MessagePort | Worker) => async (message: Messages.Call | Messages.Queue): Promise<void> => {
		let theFunction: UnknownFunction, funcToExec: UnknownFunction;

		if (!module.loaded) await moduleLoaded;

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		if (module.parent!.exports[message.func] !== undefined) theFunction = module.parent!.exports[message.func];
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		else if (this._internalFunctions![message.func as keyof InternalFunctions.Type] !== undefined) theFunction = this._internalFunctions![message.func as keyof InternalFunctions.Type];
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		else throw new Error(`Cannot run function in thread [${this.name}:${this.threadInfo}]. Function ${JSON.stringify(message.func)} is ${typeof theFunction!}. `);

		if (theFunction.constructor.name !== "AsyncFunction") funcToExec = async (...args) => theFunction(...args);
		else funcToExec = theFunction;
		this.working++;
		await funcToExec(...message.data)
			.then(
				data => messagePort.postMessage({ 
					type: "resolve",
					data,
					promiseKey: message.promiseKey
				}, data?.transfers||[]),
				data => messagePort.postMessage({ 
					type: "reject",
					data,
					promiseKey: message.promiseKey
				})
			);
		this.working--;
	}

	/**
	 * Calls a thread function.
	 * @param {string} func Key of `function` to execute.
	 * @param {*} data Data to give to the `function`.
	 * @param {number|string} promiseKey Unique key used for returned promise.
	 * 
	 * @returns {Promise} Promise that resolves with function result.
	 */
	_callThreadFunction(func: string, data: unknown[], type="call"): Promise<unknown> {
		const promiseKey = this._promiseKey++;
		if (this._promises[promiseKey] != undefined) throw new Error("Duplicate promise key!");
		// Store the resolve/reject functions in this._promises
		const thisStack = new Error().stack;
		const promise = new Promise((resolve, reject) => this._promises[promiseKey] = { 
			resolve, 
			reject: err => {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				if (err.stack) err.stack += "\n"+thisStack!.replace("Error\n", "");
				reject(err);
			}
		});
		// Ask the thread to execute/queue the function
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.messagePort!.postMessage({
			type, 
			func,
			data,
			promiseKey			
		});
		// Delete the promise from the cache once its resolved
		return promise;
	}
}
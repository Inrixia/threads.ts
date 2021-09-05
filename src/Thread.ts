import { isMainThread, workerData, MessageChannel, MessagePort, Worker } from "worker_threads";
import { ThreadStore } from "./ThreadStore";
import type ParentPool from "./ParentPool";

import type { UnknownFunction, ThreadInfo, ThreadOptions, Messages, ThreadExports, ThreadData, AnyMessage, PromisefulModule, InternalFunctions } from "./Types";

// Wrap around the `module.loaded` param so we only run functions after this module has finished loading
let _moduleLoaded = false;
const moduleLoaded: Promise<boolean> = new Promise((resolve) => {
	_moduleLoaded = module.loaded;
	Object.defineProperty(module, "loaded", {
		get: () => {
			if (_moduleLoaded) resolve(true);
			return _moduleLoaded;
		},
		set: (value) => {
			if (_moduleLoaded) resolve(true);
			_moduleLoaded = value;
		},
	});
});

import { EventEmitter } from "events";
import path from "path";

type FunctionHandler = (message: Messages["Call"] | Messages["Queue"]) => Promise<void>;

export class Thread<M extends ThreadExports = ThreadExports, D extends ThreadData = undefined> extends EventEmitter {
	private _threadStore: ThreadStore;
	public workerPort?: MessagePort | Worker;
	public data?: D;
	public threadInfo?: string;

	protected _sharedArrayBuffer: SharedArrayBuffer;

	private _promises: {
		[key: string]: {
			resolve: (value: unknown) => void;
			reject: (reason: Error) => void;
		};
	};
	private _promiseKey: number;
	private _functionQueue: {
		functionHandler: FunctionHandler;
		message: Messages["Call"] | Messages["Queue"];
	}[];

	private _stopExecution: boolean;

	public importedThreads: {
		[key: string]: Thread<ThreadExports, ThreadData>;
	};

	private _internalFunctions?: InternalFunctions;

	public static spawnedThreads: {
		[key: string]: Array<Thread<ThreadExports, ThreadData>>;
	} = {};

	public exited: Promise<number>;
	private _exited: boolean;
	private _exitResolve!: (code: number) => void;
	private _exitReject!: (err: Error) => void;

	/**
	 * Returns a promise containing a constructed `Thread`.
	 * @param {MessagePort} workerPort Port the thread will communicate on
	 * @param {Object} options Data passed to thread on start
	 * @param {SharedArrayBuffer} options.sharedArrayBuffer Shared memory containing thread parameters
	 */
	constructor(workerPort: Worker | MessagePort | false, options: ThreadOptions<D>) {
		super();
		this._sharedArrayBuffer = options.sharedArrayBuffer || new SharedArrayBuffer(16);
		this._threadStore = new ThreadStore(this._sharedArrayBuffer);
		this.importedThreads = {};

		this.data = options.data;
		this.threadInfo = options.threadModule;

		this._promises = {};
		this._promiseKey = 0;
		this._functionQueue = [];

		this._stopExecution = false;

		this._exited = false;
		this.exited = new Promise((resolve, reject) => {
			this._exitResolve = resolve;
			this._exitReject = reject;
		});
		this.exited.then((exitCode) => {
			this._exited = true;
			for (const { reject } of Object.values(this._promises)) {
				reject(new Error(`Worker exited with code ${exitCode}`));
			}
		});
		this.exited.catch((error) => {
			this._exited = true;
			for (const { reject } of Object.values(this._promises)) {
				reject(error);
			}
		});

		if (workerPort === false) return this;
		this.workerPort = workerPort;

		this._internalFunctions = {
			runQueue: this._runQueue,
			stopExecution: this.stopExecution,
			require: this.require,
			_getThreadReferenceData: this._getThreadReferenceData,
		};

		// Create an eventlistener for handling thread events
		this.workerPort.on("message", this._messageHandler(this.workerPort));

		return new Proxy(this, {
			get: (target, key: string, receiver) => {
				if ((target as unknown as { [key: string]: unknown })[key] === undefined && key !== "then") {
					if (this._exited === true) throw new Error("Thread has exited. Check thread.exited for more info...");
					return (...args: unknown[]) => this._callThreadFunction(key, args);
				} else return Reflect.get(target, key, receiver);
			},
		});
	}

	public loadExports = (exports: ThreadExports): void => {
		if (module.parent?.exports !== undefined) module.parent.exports = exports;
	};

	// Proxy this and the queue so any function calls are translated to thread calls
	public queue = new Proxy({} as M, {
		get:
			(_target, key: string) =>
			(...args: unknown[]) =>
				this._callThreadFunction(key, args, "queue"),
	});

	static addThread = (threadName: string, thread: Thread<ThreadExports, ThreadData> | ParentPool<ThreadExports, ThreadData>): void => {
		if (Thread.spawnedThreads[threadName] === undefined) Thread.spawnedThreads[threadName] = [thread];
		// else Thread.spawnedThreads[threadName].push(thread)
	};
	static newProxyThread = (threadName: string, exports: ThreadExports): Thread => {
		const proxyThread = new Thread(false, { threadModule: threadName });
		proxyThread.loadExports(exports);
		Thread.addThread(threadName, proxyThread);
		return proxyThread;
	};

	//
	// General Functions
	//
	public terminate = async (): Promise<number> => {
		if (this.workerPort === undefined) throw new Error("Worker does not exist!");
		const exitCode = await (this.workerPort as Worker).terminate();
		this._exitResolve(exitCode);
		return exitCode;
	};

	//
	// Event Functions
	//
	public emit = (eventName: string, ...args: Array<unknown>): boolean => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.workerPort!.postMessage({ type: "event", eventName, args });
		return super.emit(eventName, ...args);
	};

	//
	// Exported functions
	//

	/**
	 * Stops execution of the function queue.
	 */
	public stopExecution = async (): Promise<true> => (this._stopExecution = true);

	/**
	 * Imports a reference to a running thread by its threadName,
	 * @example // To load a reference to the thread running file `./somepath/helloWorld`
	 * const helloWorldThread = thisThread.require('helloWorld')
	 * thisThread.threads['helloWorld'] // Also set to the thread reference for non async access
	 */
	public require = async <MM extends ThreadExports, DD extends ThreadData = undefined>(
		threadName: string,
		options?: { isPath?: true }
	): Promise<Thread<MM, DD> & Omit<PromisefulModule<MM>, "require">> => {
		if (options?.isPath === true) threadName = path.join(path.dirname(this.threadInfo!), threadName).replace(/\\/g, "/");
		if (this.importedThreads[threadName] === undefined) {
			const threadResources = (await this._callThreadFunction("_getThreadReferenceData", [threadName])) as ThreadInfo;
			this.importedThreads[threadName] = new Thread(threadResources.workerPort, threadResources.workerData);
		}
		return this.importedThreads[threadName] as unknown as PromisefulModule<MM> & Thread<MM, DD>;
	};

	/**
	 * Creates a new `workerPort` for xThread communication, handled by `_messageHandler`.
	 * Returns the new `workerPort` and this threads `workerData`.
	 * @returns {{MessagePort: MessagePort, workerData:{sharedArrayBuffer:SharedArrayBuffer} Transfers: [MessagePort]}} Object containing data needed to reference this thread.
	 */
	public _getThreadReferenceData = async (threadName: string): Promise<ThreadInfo> => {
		const seekThread = Thread.spawnedThreads[threadName];
		if (seekThread !== undefined) {
			if (seekThread[0].workerPort === undefined) return seekThread[0].buildReferenceData();
			return (await seekThread[0]._callThreadFunction("_getThreadReferenceData", [])) as ThreadInfo;
		}
		if (isMainThread && seekThread == undefined) {
			throw new Error(`Thread ${threadName} has not been spawned! Spawned Threads: ${JSON.stringify(Object.keys(Thread.spawnedThreads))}`);
		}
		return this.buildReferenceData();
	};
	public buildReferenceData = async (): Promise<ThreadInfo> => {
		const { port1, port2 } = new MessageChannel();
		port2.on("message", this._messageHandler(port2));
		return { workerPort: port1, workerData: workerData || {}, transfers: [port1] };
	};

	//
	// Thread shared data
	//

	get working(): number {
		return this._threadStore.working;
	}
	set working(value: number) {
		this._threadStore.working = value;
	}

	get queued(): number {
		return this._threadStore.queued;
	}
	set queued(value: number) {
		this._threadStore.queued = value;
	}

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
	private _queueSelfFunction = async (message: Messages["Queue"] | Messages["Call"], functionHandler: FunctionHandler): Promise<void> => {
		this._functionQueue.push({ functionHandler, message });
		this.queued++;
	};

	/**
	 * Runs thread queue.
	 * @returns {Promise<number>} functions run.
	 */
	private _runQueue = async (): Promise<number> => {
		if (this._functionQueue.length === 0) return 0;
		let functionsRun = 0;
		while (this._functionQueue.length > 0) {
			if (this._stopExecution) break;
			const info = this._functionQueue.pop();
			this.queued--;
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			await info!.functionHandler(info!.message);
			functionsRun++;
		}
		return functionsRun;
	};

	//
	// Thread call handling
	//

	/**
	 * Handler function for thread communication.
	 * @param {Object} message
	 * @param {string} message.type
	 */
	private _messageHandler = (workerPort: MessagePort | Worker): ((message: AnyMessage) => void) => {
		const functionHandler = this._functionHandler(workerPort);
		return (message: AnyMessage) => {
			// Call to run a local function
			switch (message.type) {
				case "call":
					functionHandler(message).catch((data: Error) =>
						workerPort.postMessage({
							type: "reject",
							data,
							promiseKey: message.promiseKey,
						} as Messages["Reject"])
					);
					break;
				case "resolve":
					this._promises[message.promiseKey].resolve(message.data);
					delete this._promises[message.promiseKey];
					break;
				case "reject":
					if (message.data?.stack) {
						// Build a special stacktrace that contains all thread info
						message.data.stack = message.data.stack.replace(/\[worker eval\]/g, this.threadInfo as string);
					}
					this._promises[message.promiseKey].reject(message.data);
					delete this._promises[message.promiseKey];
					break;
				case "event":
					super.emit(message.eventName, ...message.args);
					break;
				case "queue":
					this._queueSelfFunction(message, functionHandler).catch((data: Error) =>
						workerPort.postMessage({
							type: "reject",
							data,
							promiseKey: message.promiseKey,
						} as Messages["Reject"])
					);
					break;
				case "uncaughtErr":
					if (message.err.stack) {
						// Build a special stacktrace that contains all thread info
						message.err.stack = message.err.stack.replace(/\[worker eval\]/g, this.threadInfo as string);
					}
					this._exitReject(message.err);
					break;
				case "exit":
					this._exitResolve(message.code);
					break;
			}
		};
	};

	/**
	 * Returns a function for handling xThread funciton calls.
	 * @param workerPort the port calls are handled over.
	 * @returns xThread function handler.
	 */
	private _functionHandler =
		(workerPort: MessagePort | Worker) =>
		async (message: Messages["Call"] | Messages["Queue"]): Promise<void> => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let theProperty: any, funcToExec: UnknownFunction;

			if (!module.loaded) await moduleLoaded;

			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			if (module.parent!.exports[message.func] !== undefined) theProperty = module.parent!.exports[message.func];
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			else if (this._internalFunctions !== undefined && this._internalFunctions[message.func as keyof InternalFunctions] !== undefined)
				theProperty = this._internalFunctions[message.func as keyof InternalFunctions];
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			else throw new Error(`Cannot run function in thread [${this.threadInfo}]. Function ${JSON.stringify(message.func)} is ${typeof theProperty!}. `);

			if (theProperty.constructor.name === "Function") funcToExec = async (...args) => theProperty(...args);
			else if (theProperty.constructor.name !== "AsyncFunction") funcToExec = async () => theProperty;
			else funcToExec = theProperty;
			this.working++;
			await funcToExec(...message.data).then(
				(data) =>
					workerPort.postMessage(
						{
							type: "resolve",
							data,
							promiseKey: message.promiseKey,
						},
						data?.transfers || []
					),
				(data) =>
					workerPort.postMessage({
						type: "reject",
						data,
						promiseKey: message.promiseKey,
					})
			);
			this.working--;
		};

	/**
	 * Calls a thread function.
	 * @param {string} func Key of `function` to execute.
	 * @param {*} data Data to give to the `function`.
	 * @param {number|string} promiseKey Unique key used for returned promise.
	 *
	 * @returns {Promise} Promise that resolves with function result.
	 */
	private _callThreadFunction(func: string, data: unknown[], type = "call"): Promise<unknown> {
		const promiseKey = this._promiseKey++;
		if (this._promises[promiseKey] !== undefined) throw new Error("Duplicate promise key!");
		// Store the resolve/reject functions in this._promises
		const thisStack = new Error().stack;
		const promise = new Promise(
			(resolve, reject) =>
				(this._promises[promiseKey] = {
					resolve,
					reject: (err) => {
						// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
						if (err.stack) err.stack += "\n" + thisStack!.replace("Error\n", "");
						reject(err);
					},
				})
		);
		// Ask the thread to execute/queue the function
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.workerPort!.postMessage({
			type,
			func,
			data,
			promiseKey,
		});
		// Delete the promise from the cache once its resolved
		return promise;
	}
}

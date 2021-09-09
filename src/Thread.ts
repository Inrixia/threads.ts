import { isMainThread, workerData, MessageChannel, MessagePort, Worker } from "worker_threads";
import { ThreadStore } from "./ThreadStore";
import type ParentPool from "./ParentPool";

import type {
	UnknownFunction,
	ThreadInfo,
	ThreadOptions,
	Messages,
	ThreadExports,
	ThreadData,
	AnyMessage,
	PromisefulModule,
	InternalFunctions,
	ThreadExitInfo,
} from "./Types";

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
import { ParentThread } from "./Parent";

type FunctionHandler = (message: Messages["Call"] | Messages["Queue"]) => Promise<void>;

export class Thread<M extends ThreadExports = ThreadExports, D extends ThreadData = undefined> extends EventEmitter {
	private _threadStore: ThreadStore;
	public workerPort?: MessagePort | Worker;
	public data?: D;
	public threadModule?: string;

	protected _sharedArrayBuffer: SharedArrayBuffer;

	private _promises: {
		[key: string]: {
			resolve: (value: unknown) => void;
			reject: (reason: Error) => void;
		};
	} = {};
	private _promiseKey: number = 0;
	private _functionQueue: {
		functionHandler: FunctionHandler;
		message: Messages["Call"] | Messages["Queue"];
	}[] = [];

	private _stopExecution: boolean = false;

	public importedThreads: Record<string, Thread<ThreadExports, ThreadData>> = {};

	private _internalFunctions?: InternalFunctions;

	public static spawnedThreads: Record<string, Thread<ThreadExports, ThreadData>> = {};

	public exited: Promise<ThreadExitInfo>;
	private _exited: boolean = false;
	private _exitResolve!: (info: ThreadExitInfo) => void;

	public get running(): boolean {
		return !this._exited;
	}

	private proxyPorts: MessagePort[] = [];

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

		this.data = options.data;
		this.threadModule = options.threadModule;

		this.exited = new Promise((res) => (this._exitResolve = res));
		this.exited.then((exitInfo) => {
			this._exited = true;
			for (const { reject } of Object.values(this._promises)) {
				if (exitInfo.err !== undefined) reject(exitInfo.err);
				else reject(new Error(`Worker exited with code ${exitInfo.code}`));
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
					if (!this.running) throw new Error("Thread has exited. Check thread.exited for more info...");
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
		Thread.spawnedThreads[threadName] = thread;
		thread.exited.then(() => delete Thread.spawnedThreads[threadName]);
	};
	static newProxyThread = <E extends ThreadExports>(threadName: string, exports: E): ParentThread<E> => {
		const proxyThread = new Thread(false, { threadModule: threadName });
		proxyThread.loadExports(exports);
		Thread.addThread(threadName, proxyThread);
		return proxyThread as ParentThread<E>;
	};

	//
	// General Functions
	//
	public terminate = async (): Promise<number> => {
		if (this.workerPort === undefined) throw new Error("Worker does not exist!");
		const exitCode = await (this.workerPort as Worker).terminate();
		this._exitResolve({ code: exitCode });
		return exitCode;
	};

	//
	// Event Functions
	//
	public emit = (eventName: string, ...args: Array<unknown>): boolean => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.workerPort!.postMessage({ type: "event", eventName, args });
		for (const proxyPort of this.proxyPorts) proxyPort.postMessage({ type: "event", eventName, args });
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
		const seekThread = this.importedThreads[threadName];
		if (options?.isPath === true) threadName = path.join(path.dirname(this.threadModule!), threadName).replace(/\\/g, "/");
		if (seekThread === undefined || ((seekThread === undefined) !== undefined && seekThread._exited === false)) {
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
			if (seekThread.workerPort === undefined) return seekThread.buildReferenceData();
			return (await seekThread._callThreadFunction("_getThreadReferenceData", [])) as ThreadInfo;
		}
		if (isMainThread && seekThread == undefined) {
			throw new Error(`Thread ${threadName} has not been spawned! Spawned Threads: ${JSON.stringify(Object.keys(Thread.spawnedThreads))}`);
		}
		return this.buildReferenceData();
	};
	public buildReferenceData = async (): Promise<ThreadInfo> => {
		const { port1, port2 } = new MessageChannel();
		this.proxyPorts.push(port2);
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
						message.data.stack = message.data.stack.replace(/.*\[worker eval\]/g, this.threadModule as string);
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
				case "exit":
					if (message.exitInfo.err?.stack !== undefined) {
						// Build a special stacktrace that contains all thread info
						message.exitInfo.err.stack = message.exitInfo.err.stack.replace(/\[worker eval\]/g, this.threadModule as string);
					}
					this.terminate();
					this._exitResolve(message.exitInfo);
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
			else throw new Error(`Cannot run function in thread [${this.threadModule}]. Function ${JSON.stringify(message.func)} is ${typeof theProperty!}. `);

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

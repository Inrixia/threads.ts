import { Thread } from "./Thread"; 
// import ThreadStore from "./ThreadStore";
import { ParentClass } from "./Parent";

import { ThreadOptions, InternalFunctions, UnknownFunction, ThreadExports } from "./Types";

export default class ParentPool<M extends ThreadExports, D> extends Thread<M, D> {
	private _threadSelect: number;

	private _subThreads: Array<ParentClass<M, D>>;
	private randomID: number;
	
	public pool: boolean;

	/**
	 * Spawns a collection of new `childThreads` and returns class to interface them.
	 * @param {string} threadInfo File or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {string} [options.name] Name of thread, used for imports from other threads.
	 * @param {number} [options.count] Number of threads in ParentPool to spawn. Defaults to 2.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {*} [options.data] Data to be passed to thread as module.parent.thread.data
	 */
	constructor(threadInfo: string, options: ThreadOptions<D>) {
		super(false, options);

		if (!options.count) options.count = 4;
		if (options.count < 1) options.count = 1;

		this._subThreads = [];
		this._threadSelect = 0;

		Thread.addThread(options.name || threadInfo, this);

		this.randomID = Math.random();
		this.name = options.name;
		this.threadInfo = threadInfo;

		this.pool = true;

		// Spawn parent threads
		for (let i = 0; i < options.count; i++)
			this._subThreads.push(
				new ParentClass(threadInfo, {
					name: `${options.name}_${i}_${this.randomID}`,
					eval: options.eval,
					sharedArrayBuffer: this._sharedArrayBuffer,
					data: options.data,
				})
			);

		return new Proxy(this, {
			get: (target, key: string, receiver) => {
				if ((target as unknown as { [key: string]: unknown })[key] === undefined && key != "then") {
					return (...args: unknown[]) => this._subThreads[this.threadSelect]["_callThreadFunction"](key, args, "call");
				} else return Reflect.get(target, key, receiver);
			},
		});
	}

	// Proxy this and the queue so any function calls are translated to thread calls
	// THIS NEEDS TO BE FIXED
	// public queue = new Proxy({} as M, {
	// 	// Calls on the parent to request the child to queue the specified function
	// 	get: (_target, key: keyof M) => (...args: unknown[]) => this._subThreads[this.threadSelect]["_callThreadFunction"](key, args, "queue")
	// });
	// public all = new Proxy({} as M, {
	// 	get: (_target, key: keyof M) => (...args: unknown[]) => this._forAllThreads(key, ...args)
	// });

	get threadSelect(): number {
		if (this._threadSelect > this._subThreads.length - 1) this._threadSelect = 0;
		return this._threadSelect++;
	}
	set threadSelect(_value: number) {
		throw new Error("Cannot set property \"threadSelect\" on a ParentPool.");
	}

	/**
	 * Runs thread queues.
	 * @returns functions run.
	 */
	runQueue: InternalFunctions.RunQueue = async () => (await this._forAllThreads("runQueue")) as number[];
	/**
	 * Stops execution of the function queues.
	 */
	stopExecution: InternalFunctions.StopExecution = async () => (await this._forAllThreads("stopExecution")) as boolean[];

	/**
	 * Calls a function on all threads.
	 * @param {string} func Name of function to call.
	 * @param {*} ...args Arguments to pass to function.
	 */
	_forAllThreads = (func: string, ...args: unknown[]): Promise<unknown[]> => Promise.all(this._subThreads.map(thread => (thread as ParentClass<M, D> & { [key: string]: UnknownFunction })[func](...args)));
}

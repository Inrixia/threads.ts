import { Worker } from "worker_threads";
import path from "path";

const threadPath = path.join(__dirname, "./Thread.js").replace(/\\/g, "\\\\");

import { Thread } from "./Thread";

import { ThreadExports, ThreadOptions, PromisefulModule } from "./Types";

/**
 * Spawns a new `childThread` and returns a class to interface with it.
 * @param {string} threadInfo File, Module name or stringified code for thread to run.
 * @param {Object} options Options for spawned thread.
 * @param {string} [options.name] Name of thread, used for imports from other threads.
 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
 * @param {*} [options.data] Data to be passed to thread as module.parent.thread.data
 */
export const Parent = <M extends ThreadExports, D = undefined>(...args: [threadInfo: string, options?: ThreadOptions<D>]): PromisefulModule<M> & ParentClass<M, D> => new ParentClass(...args) as unknown as PromisefulModule<M> & ParentClass<M, D>;
export class ParentClass<M extends ThreadExports = ThreadExports, D = undefined> extends Thread<M, D> {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadInfo File, Module name or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {string} [options.name] Name of thread, used for imports from other threads.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {*} [options.data] Data to be passed to thread as module.parent.thread.data
	 */
	constructor(threadInfo: string, options: ThreadOptions<D> = {}) {
		super(
			new Worker(`
					const { parentPort, workerData } = require('worker_threads');
					module.thread = new (require('${threadPath}').Thread)(parentPort, workerData);
					${options.eval?threadInfo:`module.exports = require('${threadInfo.replace(/\\/g, "\\\\")}')`}
				`, 
			{ workerData: options, eval: true }
			),
			options
		);
		Thread.addThread(options.name||threadInfo, this);
		this.name = options.name;
		this.threadInfo = threadInfo;
	}
}
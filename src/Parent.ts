/* eslint-disable indent */
import { Worker } from "worker_threads";
import path from "path";

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
export const Parent = <M extends ThreadExports, D = unknown>(...args: [threadInfo: string, options?: ThreadOptions<D>]): PromisefulModule<M> & ParentClass<M, D> => new ParentClass(...args) as unknown as PromisefulModule<M> & ParentClass<M, D>;
export class ParentClass<M extends ThreadExports = ThreadExports, D = unknown> extends Thread<M, D> {
	/**
	 * Spawns a new `childThread` and returns a class to interface with it.
	 * @param {string} threadInfo File, Module name or stringified code for thread to run.
	 * @param {Object} options Options for spawned thread.
	 * @param {boolean} [options.eval] Indicates if `threadFile` is stringified code or a file. If true `options.threadName` must be given.
	 * @param {SharedArrayBuffer} [options.sharedArrayBuffer] Shared array buffer to use for thread.
	 * @param {*} [options.data] Data to be passed to thread as module.parent.thread.data
	 */
	constructor(threadInfo: string, options: ThreadOptions<D> = {}) {
		super(
			new Worker(`
					const { parentPort, workerData } = require('worker_threads');
					const onErr = err => {
						parentPort.postMessage({ type: "uncaughtErr", err })
						process.exit()
					}
					process.on('exit', code => parentPort.postMessage({ type: "exit", code }))
					process.on('uncaughtException', onErr);
					process.on('unhandledRejection', onErr);
					module.thread = new (require('${path.join(__dirname, "./Thread.js").replace(/\\/g, "\\\\")}').Thread)(parentPort, workerData);
					${(() => {
						if (options.eval) return threadInfo;
						else {
							const rootPath = require.main?.filename || module.parent?.parent?.filename;
							if (rootPath === undefined) throw new Error(`Trying to spawn thread ${threadInfo}... But require.main.filename & module.parent?.parent?.filename is undefined!`);
							options.threadInfo = threadInfo = path.join(path.dirname(rootPath), threadInfo).replace(/\\/g, "/");
							return `module.exports = require('${options.threadInfo}')`;
						}
					})()}
				`,
			{ workerData: options, eval: true }
			),
			options
		);
		Thread.addThread(threadInfo, this);
	}
}
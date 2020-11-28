import { MessagePort } from "worker_threads";

import type Thread from "./Thread";

export declare type ThreadOptions<T> = {
	name?: string;
	threadInfo?: string;
	eval?: boolean;
	sharedArrayBuffer: SharedArrayBuffer;
	data?: T;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare type UnknownFunction = (...args: any[]) => Promise<any>;

export declare namespace InternalFunctions {
	export declare type RunQueue = () => Promise<number>
	export declare type StopExecution = () => Promise<boolean>
	export declare type Require = <T extends Thread<D>>(threadName: string) => Promise<T>
	export declare type GetThreadReferenceData = (threadName: string) => Promise<ThreadInfo>

	export declare type Type = {
		runQueue: RunQueue
		stopExecution: StopExecution,
		require: Require
		_getThreadReferenceData: GetThreadReferenceData
	}
}


export declare type ThreadInfo = {
	messagePort: MessagePort;
	workerData: {
		sharedArrayBuffer: SharedArrayBuffer;
	};
	transfers: [MessagePort];
};

export declare namespace Messages {
	export declare type Reject = {
		type: "reject"
		data: Error
		promiseKey: number
	}
	export declare type Resolve = {
		type: "resolve"
		data: Array<unknown>
		promiseKey: number
	}
	export declare type Event = {
		type: "event"
		eventName: string
		args: Array<unknown>
		promiseKey: number
	}
	export declare type Call = {
		func: string
		type: "call"
		data: Array<unknown>
		promiseKey: number
	}
	export declare type Queue = {
		func: string
		type: "queue"
		data: Array<unknown>
		promiseKey: number
	}
	export declare type AnyMessage = Reject | Resolve | Event | Call | Queue
}
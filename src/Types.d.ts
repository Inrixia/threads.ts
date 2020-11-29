import { MessagePort } from "worker_threads";

import type Thread from "./Thread";

export declare type ValueOf<T> = T[keyof T];

export declare type ThreadExports = {
	[key: string]: unknown
}

export declare type ThreadData = undefined | unknown

export declare type ThreadModule<D> = NodeJS.Module & { 
	thread: Thread<ThreadExports, D>,
	exports: ThreadExports
}

export declare type ThreadOptions<T> = {
	name?: string;
	eval?: boolean;
	sharedArrayBuffer?: SharedArrayBuffer;
	data?: T;
	count?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare type UnknownFunction = (...args: any[]) => Promise<any>;

export declare namespace InternalFunctions {
	export declare type RunQueue = () => Promise<number | number[]>
	export declare type StopExecution = () => Promise<boolean | boolean[]>
	export declare type Require = <MM extends ThreadExports, DD extends ThreadData>(threadName: string) => Promise<Thread<MM, DD>>
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
		func: keyof ThreadExports
		type: "call"
		data: Array<unknown>
		promiseKey: number
	}
	export declare type Queue = {
		func: keyof ThreadExports
		type: "queue"
		data: Array<unknown>
		promiseKey: number
	}
	export declare type AnyMessage = Reject | Resolve | Event | Call | Queue
}
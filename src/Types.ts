import { MessagePort } from "worker_threads";

import type { Thread } from "./Thread";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnsafeReturnType<T> = T extends (...args: any[]) => infer R ? R : any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnsafeParameters<T> = T extends (...args: infer P) => any ? P : never;

export type PromisefulModule<M extends ThreadExports> = { 
	// eslint-disable-next-line @typescript-eslint/ban-types
	[K in keyof M]: M[K] extends Function ? (...args: UnsafeParameters<M[K]>) => Promise<UnsafeReturnType<M[K]>> : () => Promise<M[K]>
}

export type ThreadExports = {
	[key: string]: unknown
}

export type ThreadData = undefined | unknown

export type ThreadModule<E extends ThreadExports = ThreadExports, D = unknown> = NodeJS.Module & { 
	thread: Thread<E, D>,
	exports: E
}

export type ThreadOptions<T> = {
	name?: string;
	eval?: boolean;
	sharedArrayBuffer?: SharedArrayBuffer;
	data?: T;
	count?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnknownFunction = (...args: any[]) => Promise<any>;


export type ThreadInfo = {
	messagePort: MessagePort;
	workerData: {
		sharedArrayBuffer: SharedArrayBuffer;
	};
	transfers: [MessagePort];
};

export type InternalFunctions = {
	runQueue: () => Promise<number | number[]>;
	stopExecution: () => Promise<boolean | boolean[]>;
	require: <MM extends ThreadExports, DD extends ThreadData>(threadName: string) => Promise<Thread<MM, DD>>
	_getThreadReferenceData: (threadName: string) => Promise<ThreadInfo>
}

export type Messages = {
	Reject: {
		type: "reject"
		data: Error
		promiseKey: number
	};
	Resolve: {
		type: "resolve"
		data: Array<unknown>
		promiseKey: number
	};
	Event: {
		type: "event"
		eventName: string
		args: Array<unknown>
		promiseKey: number
	};
	Call: {
		func: keyof ThreadExports
		type: "call"
		data: Array<unknown>
		promiseKey: number
	};
	Queue: {
		func: keyof ThreadExports
		type: "queue"
		data: Array<unknown>
		promiseKey: number
	};
}

export type AnyMessage = Messages[keyof Messages];
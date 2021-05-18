import { Parent } from "../../";

import type { ThreadModule } from "../../";
import type * as Smol from "./smol";
import type * as Child from "./child";

const thread = (module.parent as ThreadModule).thread;

thread.on("eventFromParent", (...args) => thread.emit("eventFromChild", ...args));

export const add1Slow = (num: number): Promise<number> => new Promise(resolve => setTimeout(() => resolve(num+1), Math.random()*1000));

export const add1 = async (num: number): Promise<number> => num+1;

export const add1Deep = (num: number): Promise<number> => {
	type a = { add1: typeof add1 };
	const subChild = Parent<a>("./child.js");
	return subChild.add1(num);
};

export const return1 = async (): Promise<number> => 1;

export const smol = async (s: number): Promise<number> => {
	const smol = await thread.require<typeof Smol>("./smol.js");
	return smol.smol(s);
};

export const deepSmol = async (s: number): Promise<number> => {
	const subChild = Parent<typeof Child>("./child.js");
	return subChild.smol(s);
};
// import path from "path";
// import Parent from "../../Parent";

// import type { ThreadModule } from "../../Types";
// import type * as Smol from "./smol";

// export declare type Data = undefined;
// const thread = (module.parent as ThreadModule<Data>).thread;

// thread.on("eventFromParent", (...args) => thread.emit("eventFromChild", ...args));

// export const add1Slow = (num: number): Promise<number> => new Promise(resolve => setTimeout(() => resolve(num+1), Math.random()*1000));

// const add1 = async (num: number): Promise<number> => num+1;

// export const add1Deep = async (num: number): Promise<number> => {
// 	const subChild = new Parent<{ add1: typeof add1 }, Data>(path.join(__dirname, "./util"));
// 	return subChild.add1(num);
// };

// export const return1 = async (): Promise<number> => 1;

// export const smol = async (s: number): Promise<number> => {
// 	const smol = await thread.require<typeof Smol, Data>("smol");
// 	return smol.smol(s);
// };

// export const deepSmol = async s => {
// 	const subChild = new Parent(path.join(__dirname, "./child"), { name: "child" });
// 	return subChild.smol(s);
// };


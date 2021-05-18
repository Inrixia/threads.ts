import { Parent } from "../../Parent";

import type * as smol from "./smol";
const subChild = Parent<typeof smol>("./smol");// as unknown as typeof smol & Parent<typeof smol>;

(async () => {
	console.log(await subChild.smol(1));
	console.log(await subChild.big("123"));
	console.log(await subChild.smolString());
	console.log(await subChild.zero());
})().catch(console.error);
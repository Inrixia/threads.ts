import * as smol from "./smol";

import { Parent } from "../../Parent";

import path from "path";

const subChild = Parent<typeof smol>(path.join(__dirname, "./smol"));// as unknown as typeof smol & Parent<typeof smol>;
(async () => {
	console.log(await subChild.smol(1));
	console.log(await subChild.big("123"));
	console.log(await subChild.smolString());
	console.log(await subChild.zero());
})().catch(console.error);

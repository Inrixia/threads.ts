import * as smol from "./smol";

import Parent from "../../Parent";

const subChild = new Parent<typeof smol>("./smol");
subChild.queue.smol(1);
subChild.smol(1);
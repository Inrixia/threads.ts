import { Parent } from "../";

try {
	const crashingThread = Parent("./lib/error");
} catch (err) {
	//
}

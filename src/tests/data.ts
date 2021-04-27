import type { ThreadModule } from "../";

module.exports._data = async () => (module.parent as ThreadModule).thread.data;
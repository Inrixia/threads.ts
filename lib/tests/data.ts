import type { ThreadModule } from "../Types";

module.exports._data = async () => (module.parent as ThreadModule).thread.data;
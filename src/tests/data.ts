import type { ThreadModule } from "../";

module.exports._data = async () => (module.require.main as ThreadModule).thread.data;
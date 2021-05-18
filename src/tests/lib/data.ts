import type { ThreadModule } from "../..";

export const _data = async (): Promise<unknown> => (module.parent as ThreadModule).thread.data;
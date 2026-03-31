import { createExtensionConfig } from "./configuration";

export const extensionConfig = createExtensionConfig(import.meta.env, import.meta.env.MODE);

import { HostProvider } from "../../../src/hosts/host-provider";

export const Logger = {
    info(message: string, ...args: any[]) {
        const formatted = `[WsBridge:INFO] ${message} ${args.length ? JSON.stringify(args) : ""}`;
        if (HostProvider.isInitialized()) {
            HostProvider.get().logToChannel(formatted);
        } else {
            console.log(formatted);
        }
    },
    error(message: string, error?: any) {
        const formatted = `[WsBridge:ERROR] ${message} ${error ? error.message || error : ""}`;
        if (HostProvider.isInitialized()) {
            HostProvider.get().logToChannel(formatted);
        } else {
            console.error(formatted);
        }
    },
    debug(message: string) {
        const formatted = `[WsBridge:DEBUG] ${message}`;
        if (HostProvider.isInitialized()) {
            HostProvider.get().logToChannel(formatted);
        }
    }
};

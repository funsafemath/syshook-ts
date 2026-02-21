import { ffi, SyscallHandler } from "./ffi";

let initialized = false;

export function setupUnotify(callbacks: Record<number, SyscallHandler>) {
    if (!ffi) {
        throw new Error(
            "initSyshook() function must be called before setupUnotify()",
        );
    }

    if (initialized) {
        throw new Error("setupUnotify cannot be called twice")
    }

    initialized = true;

    const callbackMap = ffi.ffiNewCallbackMap();

    for (const [sysNo, callback] of Object.entries(callbacks)) {
        ffi.ffiAddCallback(callbackMap, Number.parseInt(sysNo), callback);
    }

    ffi.ffiSetup(callbackMap);
}

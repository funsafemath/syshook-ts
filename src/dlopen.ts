export function loadLib(path: string): void {
    // it's used only once, so a global lookup is fine
    const dlopenAddr = Module.getGlobalExportByName("dlopen");
    const dlopen = new NativeFunction(dlopenAddr, "pointer", [
        "pointer",
        "int",
    ]);

    const RTLD_LAZY = 0x00001;

    const ptr = dlopen(Memory.allocUtf8String(path), RTLD_LAZY);

    if (ptr.isNull()) {
        throw new Error(dlError()?.toString());
    }
}

function dlError(): string | null {
    // it's used only once, so a global lookup is fine
    const dlerror = new NativeFunction(
        Module.getGlobalExportByName("dlerror"),
        "pointer",
        [],
    );

    return dlerror().readCString();
}

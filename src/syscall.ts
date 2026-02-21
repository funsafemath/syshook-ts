import x86_64 from "./syscalls/x86_64";
import aarch64 from "./syscalls/aarch64";

function getSyscalls(): typeof x86_64 | typeof aarch64 {
    if (Process.arch == "x64") {
        return x86_64;
    } else if (Process.arch == "arm64") {
        return aarch64;
    } else {
        throw new Error("unsupported architecture");
    }
}

export const syscall = getSyscalls();

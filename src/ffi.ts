// this entire file is horrible
import Errno from "./errno";
import { pptr, ProcessPointer } from "./mem";

export type Syscall = {
    pid: number;
    sys_nr: number;
    pc: ProcessPointer;
    args: [
        ProcessPointer,
        ProcessPointer,
        ProcessPointer,
        ProcessPointer,
        ProcessPointer,
        ProcessPointer,
    ];
};

export type SyscallHandler = (syscall: Syscall) => Response;

type NativeReadFn = NativeFunction<
    void,
    [NativePointer, number, NativePointer]
>;

function memRead<T>(
    pid: number,
    ptr: NativePointer,
    nativeReadFn: NativeReadFn,
    read_fn: (ptr: NativePointer) => T,
    size: number,
): T {
    const mem = Memory.alloc(8 + size);

    nativeReadFn(mem, pid, ptr);

    if (!mem.readS64().equals(0)) {
        throw new Error("failed to read memory");
    }

    return read_fn(mem.add(8));
}

type ReadFn<T> = (pid: number, pointer: NativePointer) => T;

interface Ffi {
    ffiReadPtr: ReadFn<NativePointer>;
    ffiReadCString: (
        pid: number,
        pointer: NativePointer,
        max_size: number,
    ) => string | null;
    ffiReadByteArray: (
        pid: number,
        pointer: NativePointer,
        read_to: NativePointer,
        len: number,
    ) => void;
    ffiNewCallbackMap: () => NativePointer;
    ffiAddCallback: (
        callbackMap: NativePointer,
        sysNo: number,
        callback: SyscallHandler,
    ) => NativePointer;
    ffiSetup: (callbacks: NativePointer) => void;
    ffiResolve: (cookie: NativePointer, response: Response) => void;
    ffiWriteBuf: (
        pid: number,
        mem_to: NativePointer,
        mem_from: NativePointer,
        len: number | UInt64,
    ) => void;
}

// ......................native callbacks can be garbage-collected, really?
const usedCallbacks = [];

const enum ResponseType {
    Continue = 0,
    Return = 1,
    Fail = 2,
    NeverRespond = 3,
}

type RetType = number | NativePointer | ProcessPointer | Int64 | UInt64;

type Response = void | RetType | Errno | "neverRespond";

export const neverRespond = "neverRespond";

export function initSyshook(mod: Module) {
    function mkNativeRead(link_name: string) {
        const nativeRead = new NativeFunction(
            mod.getExportByName(link_name),
            "void",
            ["pointer", "uint32", "pointer"],
        );
        return (pid: number, ptr: NativePointer) =>
            memRead<NativePointer>(
                pid,
                ptr,
                nativeRead,
                (ptr) => ptr.readPointer(),
                Process.pointerSize,
            );
    }

    const nativeCStringRead = new NativeFunction(
        mod.getExportByName("read_c_string"),
        "int32",
        ["pointer", "size_t", "uint32", "pointer"],
    );

    const cStringRead = (
        pid: number,
        pointer: NativePointer,
        max_size: number,
    ) => {
        const mem = Memory.alloc(max_size + 1);
        if (nativeCStringRead(mem, max_size + 1, pid, pointer) != 0) {
            throw new Error("failed to read C string");
        }
        return mem.readCString();
    };

    const nativeAddCallback = new NativeFunction(
        mod.getExportByName("insert_callback"),
        "void",
        ["pointer", "uint32", "pointer"],
    );

    const addCallback = (
        callbackMap: NativePointer,
        sysNo: number,
        callback: SyscallHandler,
    ) => {
        let nativeHandler = new NativeCallback(
            (cookie, pid, sys_nr, pc, arg0, arg1, arg2, arg3, arg4, arg5) => {
                try {
                    let res = callback({
                        pid,
                        sys_nr,
                        pc: pptr(pid, pc),
                        args: [
                            pptr(pid, arg0),
                            pptr(pid, arg1),
                            pptr(pid, arg2),
                            pptr(pid, arg3),
                            pptr(pid, arg4),
                            pptr(pid, arg5),
                        ],
                    });
                    ffi.ffiResolve(cookie, res);
                } catch (err) {
                    console.error(
                        `handler for ${sys_nr} failed, continuing syscall; ${err}`,
                    );
                    ffi.ffiResolve(cookie, undefined);
                }
            },
            "void",
            [
                "pointer",
                "uint32",
                "int32",
                "pointer",
                "pointer",
                "pointer",
                "pointer",
                "pointer",
                "pointer",
                "pointer",
            ],
        );
        usedCallbacks.push(nativeHandler);
        nativeAddCallback(callbackMap, sysNo, nativeHandler);
        return nativeHandler;
    };

    const nativeResolve = new NativeFunction(
        mod.getExportByName("resolve"),
        "void",
        ["pointer", "uint8", "pointer"],
    );

    const nativeWriteBuf = new NativeFunction(
        mod.getExportByName("write_buf"),
        "int32",
        ["pointer", "size_t", "uint32", "pointer"],
    );

    const nativeReadBuf = new NativeFunction(
        mod.getExportByName("read_byte_array"),
        "int32",
        ["pointer", "size_t", "uint32", "pointer"],
    );

    ffi = {
        ffiReadPtr: mkNativeRead("read_usize"),
        ffiReadCString: cStringRead,
        ffiNewCallbackMap: new NativeFunction(
            mod.getExportByName("new_callback_map"),
            "pointer",
            [],
        ),
        ffiAddCallback: addCallback,
        ffiSetup: new NativeFunction(
            mod.getExportByName("supervise"),
            "void",
            ["pointer"],
        ),
        ffiResolve: (cookie, response) => {
            if (response === undefined) {
                nativeResolve(
                    cookie,
                    ResponseType.Continue,
                    new NativePointer(0),
                );
                return;
            } else if (response instanceof Errno) {
                nativeResolve(
                    cookie,
                    ResponseType.Fail,
                    new NativePointer(response.errno),
                );
                return;
            } else if (response === "neverRespond") {
                // unnecessary, as we can just not call the function, but it frees the Box<(response, fd)>
                nativeResolve(
                    cookie,
                    ResponseType.NeverRespond,
                    new NativePointer(0),
                );
                return;
            } else if (response instanceof ProcessPointer) {
                nativeResolve(
                    cookie,
                    ResponseType.Return,
                    new NativePointer(response.asPtr()),
                );
                return;
            } else {
                nativeResolve(
                    cookie,
                    ResponseType.Return,
                    new NativePointer(response),
                );
                return;
            }
        },
        ffiWriteBuf(pid, mem_to, mem_from, len) {
            if (nativeWriteBuf(mem_from, len, pid, mem_to) != 0) {
                throw new Error("failed to write memory");
            }
        },
        ffiReadByteArray(pid, pointer, read_to, len) {
            if (nativeReadBuf(read_to, len, pid, pointer) != 0) {
                throw new Error("failed to read memory");
            }
        },
    };
}

export let ffi: Ffi;

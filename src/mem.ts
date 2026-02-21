import { ffi } from "./ffi";

export class ProcessPointer {
    pid: number;
    ptr: NativePointer;

    constructor(pid: number, ptr: NativePointer) {
        this.pid = pid;
        this.ptr = ptr;
    }

    toString(): string {
        return `${this.ptr} (pid ${this.pid})`;
    }

    readPointer(): NativePointer {
        return ffi.ffiReadPtr(this.pid, this.ptr);
    }

    readCString(max_size: number): string | null {
        //** Note that this function allocates max_size bytes regardless of the actual string length */
        return ffi.ffiReadCString(this.pid, this.ptr, max_size);
    }

    readByteArray(len: number): ArrayBuffer | null {
        const buf = Memory.alloc(len);
        ffi.ffiReadByteArray(this.pid, this.ptr, buf, len);
        return buf.readByteArray(len);
    }

    writeByteArray(value: ArrayBuffer | number[]): this {
        const len = value instanceof ArrayBuffer
            ? value.byteLength
            : value.length;
        const array = Memory.alloc(len);
        array.writeByteArray(value);

        ffi.ffiWriteBuf(this.pid, this.ptr, array, len);
        return this;
    }

    writeUtf8String(value: string): this {
        const bytes = Buffer.from(value, "utf-8").buffer;
        const array = Memory.alloc(bytes.byteLength + 1);

        if (!(bytes instanceof ArrayBuffer)) {
            throw new Error(
                "encoded string buffer is not an instance of ArrayBuffer",
            );
        }

        array.writeByteArray(bytes);
        array.add(bytes.byteLength).writeU8(0);

        ffi.ffiWriteBuf(this.pid, this.ptr, array, bytes.byteLength + 1);
        return this;
    }

    asPtr(): NativePointer {
        return this.ptr;
    }

    asI32(): number {
        return this.ptr.toInt32();
    }

    asU32(): number {
        return this.ptr.toUInt32();
    }

    asI64(): Int64 {
        // why on earth does int64 constructor not accept a native pointer
        return new Int64(this.ptr.toString());
    }

    asU64(): UInt64 {
        // .........
        return new UInt64(this.ptr.toString());
    }
}

export function pptr(pid: number, ptr: NativePointer): ProcessPointer {
    return new ProcessPointer(pid, ptr);
}

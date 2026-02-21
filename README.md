System call hooking for [Frida](https://frida.re/) using [seccomp user notifications](https://manpages.debian.org/testing/manpages-dev/seccomp_unotify.2.en.html)

`seccomp_unotify` is great for system call hooking because:
1) It's performant, you don't spend any time on system calls you don't intercept (ptr\*ce)
2) Seccomp doesn't interfere with the process much (ptr\*ce)
3) It's kernel-enforced, so you can be sure every syscall from the process and every its subprocess will be intercepted (as long as you call the setup function early enough)
4) Nobody cares to check if it's enabled

To use this library, you need to
0) Compile/download [`libsyshook.so`](https://github.com/funsafemath/syshook) 
1) Load the `libsyshook` shared library into the process by any means. 
The library is lightweight (~320kb, ~130kb compressed), you can even embed it into your js/ts source code and load it from there
2) Pass the `libsyshook` module object to the `initSyshook` function
3) Call `setupUnotify`

#### Example Usage:

```ts
// The gadget is LD_PRELOAD-ed
const MAX_PATH_LEN = 256;

// The library provides a dlopen(3) wrapper, but you probably should use something else
loadLib("./libsyshook.so")

initSyshook(Process.getModuleByName("libsyshook.so"));

setupUnotify({
	[syscall.openat]: ((syscall) => {
		const pathPtr = syscall.args[1];
		const path = pathPtr.readCString(256);
		console.warn(`openat(${path})`);
		if (path === "/dev/urandom") {
			pathPtr.writeUtf8String("/dev/zero")
		}
	}),
});

```


This will log paths of files opened with `openat(2)`, and if the path is `/dev/urandom`, it's replaced by `/dev/zero`.

Currently the sync_thread flag is disabled, which means you need to setup the library in the main thread as soon as possible, before it spawns any threads, to be able to intercept every syscall. Initializing after being loaded through frida-server/System.LoadLibrary does not always initialize the filter on the main thread, so you may consider intercepting a frequently used function (mmap), setting up a filter and then detaching.

#### API Notes

`setupUnotify` accepts a `Record<number, SyscallHandler>`, id est an object which keys are system call numbers and values are callbacks of the type `(syscall: Syscall) => void | RetType | Errno | "neverRespond"`.

- Returning `void` continues the system call.

- Returning `RetType = number | NativePointer | ProcessPointer | Int64 | UInt64` completes the system call with the specified return value (it's not forwarded to the kernel).

- Returning `Errno`, which is an enum of errors (its variants are `Errno.EPERM`, `Errno.ENOENT`, ...), sets the return value to the value corresponding to an error and completes the system call.

- Returning `"neverRespond"` will freeze the thread forever. As the Rust library uses a `ignore_non_fatal_signals` flag (`SECCOMP_FILTER_FLAG_WAIT_KILLABLE_RECV`, it's barely documented for some reason, it's not even mentioned in the manpages), the thread won't even be interrupted by the signals, except for `SIGKILL`.

`"neverRespond"` is actually surprisingly effective if you want to disable an annoying thread

  

The `Syscall` type is defined as

```ts
type Syscall = {
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
```

  

Seccomp filters are enforced by the kernel and are inherited by all spawned threads and subprocesses, therefore pointers may not belong to the address space of the current process. For this reason, syscall.args is a 6-tuple of `ProcessPointer`s, which contain a `NativePointer` and a process (task, actually) id.

`ProcessPointer` doesn't have all methods of a `NativePointer` (yet), but you may cast it to a `NativePointer` by using the `asPtr()` method or accessing the `ptr` field if you are sure it belongs to the same address space the filter was installed in. This is fine if the process spawns threads, but not subprocesses (which most processes don't spawn, really).

`syscall` object have syscalls `write(2)`, `mmap(2)`, `sched_yield(2)`, `gettid(2)` commented out, as they may cause deadlocks. If you really want to, you can pass their syscall numbers manually.

I guess the handler thread somehow synchronizes with another thread, which makes these syscalls, leading to a deadlock? 

It can be fixed by creating a fork of the process instead of a thread, but then some restrictions would apply: a thread can always access its virtual memory, but you can't guarantee that fork will be able access the memory of its parent or even a child.

A fork, however, has a different advantage: you can safely use the `sync_threads`, which retroactively applies the seccomp filter to every thread of a process.

If you really want to hook these syscalls or use `sync_threads`, feel free to modify the `src/ffi/setup.rs` file, it's quite straightforward (you also can ask your favorite slop generator to do it for you).

Alternatively, you can preload the syshook library directly and use it without Frida, see [`ctor`](https://crates.io/crates/ctor). In this case you won't need to fork to intercept these syscalls, also Rust is much more pleasant to write.

The library includes a `loadLib` function, a wrapper for `dlopen(3)`. In most cases Frida built-in library loading functions suffice, but in some environments they just don't work.

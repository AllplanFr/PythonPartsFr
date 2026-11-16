"""Windows kernel lease, inherited by AIM; process termination releases it."""
import ctypes
from ctypes import wintypes
import hashlib
import os


ENV_HANDLE = "ALLPLAN_AIM_INSTANCE_HANDLE"
MESSAGE = "AIM est d\u00e9j\u00e0 ouvert"


class AimAlreadyOpen(ValueError):
    def __init__(self):
        super().__init__(MESSAGE)


def _kernel():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateEventW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateEventW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    kernel.OpenEventW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.OpenEventW.restype = wintypes.HANDLE
    kernel.CompareObjectHandles = ctypes.WinDLL(
        "KernelBase", use_last_error=True,
    ).CompareObjectHandles
    kernel.CompareObjectHandles.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CompareObjectHandles.restype = wintypes.BOOL
    return kernel


def _name():
    # Local namespace is the Windows logon session; separate users get separate names.
    identity = os.path.normcase(os.environ["LOCALAPPDATA"])
    return "Local\\AllplanWebLauncher.AIM." + hashlib.sha256(identity.encode()).hexdigest()


class AimInstance:
    def __init__(self, *, inherit=False):
        self.kernel = _kernel()
        self.handle = None
        raw = os.environ.pop(ENV_HANDLE, None) if inherit else None
        if raw is not None:
            handle = int(raw)
            probe = self.kernel.OpenEventW(0x100000, False, _name())
            if not probe:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if not self.kernel.CompareObjectHandles(handle, probe):
                    raise ValueError("Reservation AIM heritee invalide.")
            finally:
                self.kernel.CloseHandle(probe)
            self.handle = handle
            os.set_handle_inheritable(handle, False)
            return
        handle = self.kernel.CreateEventW(None, True, False, _name())
        error = ctypes.get_last_error()
        if not handle:
            raise ctypes.WinError(error)
        if error == 183:  # ERROR_ALREADY_EXISTS: never launch another child.
            self.kernel.CloseHandle(handle)
            raise AimAlreadyOpen()
        self.handle = handle

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.handle is not None:
            handle, self.handle = self.handle, None
            if not self.kernel.CloseHandle(handle):
                raise ctypes.WinError(ctypes.get_last_error())

    def spawn(self, command, **kwargs):
        import subprocess
        startup = subprocess.STARTUPINFO()
        startup.lpAttributeList = {"handle_list": [self.handle]}
        env = dict(os.environ, **{ENV_HANDLE: str(self.handle)})
        os.set_handle_inheritable(self.handle, True)
        try:
            return subprocess.Popen(
                command, startupinfo=startup, close_fds=True, env=env, **kwargs,
            )
        finally:
            os.set_handle_inheritable(self.handle, False)

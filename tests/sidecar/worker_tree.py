"""A stubborn worker and encoder, with sockets that prove when each has exited."""

import json
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
child = len(sys.argv) > 2
if os.name == "posix":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    name = "encoder" if child else "worker"
    (root / f"{name}.json").write_text(
        json.dumps({"pid": os.getpid(), "port": listener.getsockname()[1]})
    )
    if not child:
        subprocess.Popen([sys.executable, __file__, str(root), "--child"])
    while True:
        connection, _ = listener.accept()
        connection.close()

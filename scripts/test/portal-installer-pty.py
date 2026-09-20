"""Run installer fixtures in a real terminal; all answers are synthetic test data."""
import errno
import json
import os
import pty
import select
import signal
import sys
import time

answers = json.loads(os.environ["SPARKADE_TEST_ANSWERS"])
pid, terminal = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

output = bytearray()
pending = ""
deadline = time.monotonic() + 20
status = None
try:
    while time.monotonic() < deadline:
        if select.select([terminal], [], [], 0.1)[0]:
            try:
                data = os.read(terminal, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output.extend(data)
            pending += data.decode("utf-8", errors="replace")
            if answers and answers[0][0] in pending:
                prompt, answer = answers.pop(0)
                pending = pending.split(prompt, 1)[1]
                os.write(terminal, (answer + "\n").encode())
        ended, status = os.waitpid(pid, os.WNOHANG)
        if ended:
            break
    else:
        os.kill(pid, signal.SIGKILL)
        sys.stderr.write("Installer fixture timed out\n")
finally:
    os.close(terminal)
    if status is None or status == 0:
        try:
            _, status = os.waitpid(pid, 0)
        except ChildProcessError:
            pass
sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status) if status is not None else 1)

/**
 * Finding and freeing whatever is sitting on a port.
 *
 * Starts a real listener rather than mocking lsof: the thing worth checking is that becode can
 * see a process it did not start and actually get the socket back.
 *
 * node --experimental-strip-types agent/lib/ports.check.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { holders, release } from "./ports.ts";

/** A port nothing is on right now, asked of the OS rather than guessed. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const port = await freePort();
assert.deepEqual(await holders(port), [], "a free port has no holders");

// Detached, through a shell, exactly how run_project starts an app — so the listener is a
// grandchild and the process-group kill is the path being checked.
const child = spawn(`node -e "require('net').createServer().listen(${port})"`, {
  shell: true,
  detached: true,
  stdio: "ignore",
});
for (let i = 0; i < 40 && (await holders(port)).length === 0; i++) {
  await new Promise((r) => setTimeout(r, 100));
}

const found = await holders(port);
assert.equal(found.length, 1, `expected one holder on :${port}, got ${JSON.stringify(found)}`);
assert.match(found[0].command, /node/, "the holder is reported with its command line");
assert.ok(found[0].pid > 0);

assert.equal(await release(port, [found[0].pid]), true, "the port comes back free");
assert.deepEqual(await holders(port), []);

child.kill();
console.log("ports: ok");

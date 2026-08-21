import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

/**
 * becode never uses the sandbox — `bash`, `read_file` and `write_file` are disabled, and its own
 * tools run in the app runtime against the host filesystem. Left unpinned, eve's `defaultBackend()`
 * probes for a Docker daemon on every boot, which makes the docker CLI hit the macOS keychain.
 * Pin the dependency-free backend so nothing is probed.
 */
export default defineSandbox({ backend: justbash() });

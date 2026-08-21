import { disableTool } from "eve/tools";

// becode edits real repos on this machine through its own scope-checked tools.
// A sandbox shell/file surface would be both useless here and a hole in the constraint.
export default disableTool();

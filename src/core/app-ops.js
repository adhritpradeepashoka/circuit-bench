// The app functions the CircuitBench model can ask for by name ("run it", "zoom in", "show the serial monitor", "export my project").
// Each name is one button or event that already exists in the app: the model never invents an action, and a name that is not in this table is refused.
// DOM-free: the table only says WHAT to press; src/ui/app-ops.js presses it.
export const APP_OPS = {
  // simulation
  run:        { click: 'runBtn',      say: 'Pressed Run' },
  stop:       { click: 'simStop',     say: 'Stopped the simulation' },
  pause:      { click: 'simPause',    say: 'Paused the simulation' },
  sound:      { click: 'simSound',    say: 'Switched the sound on or off' },
  // the canvas
  undo:       { click: 'undoTool',    say: 'Undid the last change' },
  redo:       { click: 'redoTool',    say: 'Redid the change' },
  zoomin:     { click: 'zoomIn',      say: 'Zoomed in' },
  zoomout:    { click: 'zoomOut',     say: 'Zoomed out' },
  fit:        { click: 'zoomFit',     say: 'Fitted everything on screen' },
  select:     { click: 'selectTool',  say: 'Switched to the select tool' },
  wiretool:   { click: 'wireTool',    say: 'Switched to the wire tool' },
  rotatesel:  { click: 'rotateTool',  say: 'Rotated the selected part' },
  duplicate:  { click: 'dupTool',     say: 'Duplicated the selected part' },
  // the sketch
  code:       { click: 'codeToggle',  say: 'Showed or hid the sketch editor' },
  blocks:     { click: 'modeBlocks',  say: 'Switched to blocks' },
  text:       { click: 'modeCode',    say: 'Switched to the code editor' },
  compile:    { click: 'codeCompile', say: 'Started compiling the sketch' },
  output:     { click: 'tabOutput',   say: 'Opened the Output tab' },
  serial:     { click: 'tabSerial',   say: 'Opened the Serial Monitor' },
  clearserial:{ click: 'serialClear', say: 'Cleared the serial monitor' },
  // projects and files
  newproject: { click: 'newProject',  say: 'Started a new project' },
  projects:   { click: 'openProjects',say: 'Opened your projects' },
  gallery:    { click: 'projGallery', say: 'Opened the shared projects' },
  export:     { click: 'exportJson',  say: 'Exported the project' },
  copy:       { click: 'copyJson',    say: 'Copied the project JSON' },
  import:     { click: 'exportBtn',   say: 'Opened the File menu: choose Import project or Import PCB there' },
  // other windows
  packs:      { click: 'workspacesBtn', say: 'Opened the resource packs' },
  community:  { click: 'communityBtn',  say: 'Opened the community' },
  feedback:   { click: 'feedbackBtn',   say: 'Opened the feedback form' },
  settings:   { click: 'settingsBtn',   say: 'Opened the settings' },
  partmaker:  { emit: 'create-part',    say: 'Opened the Part Maker' },
  robots:     { emit: 'pick-robot-type',say: 'Opened the robot type picker' },
};
export const APP_OP_NAMES = Object.keys(APP_OPS);

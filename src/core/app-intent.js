// Does this request talk about the CircuitBench app itself (the simulation, zoom, tabs, projects, the sketch editor, export …) rather than about parts?
// The instant rules below it are written for parts and would misread such requests ("wipe the serial monitor" is not "clear the bench",
// "switch project" is not "add a switch"), so those requests skip the rules and go straight to the model. DOM-free.
const APP_WORDS = [
  /\bsimulat\w*/, /\bserial\b/, /\b(zoom\w*|magnif\w*)\b/, /\b(undo|redo)\b/, /\b(compile|compiler)\b/, /\bverify (it|the|my)\b/, /\bpress verify\b/,
  /\bblocks?\b.*\b(mode|editor|coding|programming)\b|\b(mode|editor|coding|programming)\b.*\bblocks?\b|\b(switch|go|change) (to|into) blocks\b|\buse blocks\b|\bshow blocks\b|\bblocks instead\b|\bwith blocks\b/,
  /\b(text|code) (mode|editor)\b/, /\bwrite code instead\b/, /\btype code\b/,
  /\b(show|hide|open|close|toggle|reveal)\b.*\b(code|sketch|editor|output|monitor)\b/, /\b(code|sketch) (panel|editor|tab)\b/,
  /\b(empty|clear|wipe|blank|erase|reset)\b.*\b(sketch|my code|the code|serial|monitor)\b/, /\b(sketch|code) (to|as) empty\b|\bblank sketch\b|\bempty sketch\b/,
  /\b(hello world|hello)\b.*\b(sketch|serial)\b/,
  /\bprojects?\b/, /\bexport\b/, /\bimport\b/, /\bsettings?\b/, /\bapi key\b/, /\btheme\b/, /\b(resource|parts?) packs?\b|\b(show|open|browse|install|get) (me )?(the |a |some )?packs?\b|^packs?$/, /\bmore (boards|parts)\b/, /\bfeedback\b/, /\bcommunity\b/, /\bgallery\b/, /\bblog\b/,
  /\bpart maker\b/, /\b(custom|my own) (part|component)\b/, /\brobot (type|picker)\b|\b(pick|choose|set|change|switch) (a |the )?robot\b/,
  /\b(wire|select|pointer|cursor) tool\b/, /\bwiring mode\b/, /\bdraw (a )?wires?\b/, /\bmove mode\b/,
  /\b(pause|unpause)\b/, /\b(mute|unmute)\b/, /\bsound (on|off)\b|\bthe sound\b/,
  /\b(rotate|spin) (it|this)\b|\bturn (it|this) around\b|\b(rotate|turn) (the )?(selected|selection)\b|\b(rotate|turn) what i selected\b/, /\b(duplicate|clone) (it|this|the selected|the selection)\b|\bcopy and paste it\b|\bcopy of it\b/,
  /\b(fit|center|show|see) (everything|the whole|all the parts|it all)\b|\bfit (the view|to screen|it all)\b/,
  /\b(stop|start|run|play|halt|freeze|pause)( it| this)?$|^(run|start|stop|play|halt) (it|this|the)\b|\b(run|start|stop) (it|the (circuit|sim|sketch))\b|\bpress (run|stop|play|pause)\b|\bhit run\b|\btest it\b|\btry it out\b|\bfire it up\b/,
  /\brotate\b/, /\b(move|shift|nudge|push|slide|scoot|budge|pivot)\b.*\b(left|right|up|down|leftwards|rightwards|upwards|downwards)\b/, /\b(turn|spin|flip)\b.*\b(degrees?|by \d+|around|upside down)\b/,
  /\b(unwire|disconnect)\b/, /\b(remove|delete|clear|cut|strip|take)\b.*\b(all|every)\b.*\bwires?\b/, /\bwires? (from|on)\b/, /\b(all|every)( the)? wires\b/,
  /\bhide (the )?(sketch|code)\b/, /\bsketch for errors\b/, /\bswitch to (the )?(select|text|output|code|blocks)\b/,
];
export function looksLikeAppRequest(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b(in|for) (this|the) (sketch|project)\b/g, '')} `.trim();
  return APP_WORDS.some(re => re.test(t));
}

/** A question about the app ("why wont the simulation start", "how do i export") is an explanation to give, not a button to press. */
export function looksLikeQuestion(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^(whats new|what is new|what s new)\b/.test(t.replace(/[’']/g, ' '))) return false;
  return /\?\s*$/.test(t) || /^(how|why|what|whats|what s|where|when|which|who|is|are|does|do|did|will|would|should|explain|tell me)\b/.test(t.replace(/[’']/g, ' '));
}

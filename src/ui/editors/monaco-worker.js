// Normal build: Monaco's editor worker is emitted as a real file and loaded from the same origin,
// so it works under a strict Content-Security-Policy (worker-src 'self') and needs no blob:/data: URLs.
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
export default EditorWorker;

// Single-file build (opened straight from disk): there is no server to load a worker file from, so it is inlined as a blob: worker.
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline';
export default EditorWorker;

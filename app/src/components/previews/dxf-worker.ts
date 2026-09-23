// Web worker for dxf-viewer: fetching, parsing and scene preparation run here
// so a large drawing doesn't freeze the page. Spawned by dxf.tsx.
import { DxfViewer } from "dxf-viewer";

DxfViewer.SetupWorker();

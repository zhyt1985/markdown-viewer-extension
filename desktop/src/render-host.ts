import mermaid from 'mermaid';
import { handleRender, initRenderEnvironment, type RenderRequest } from '../../src/renderers/render-worker-core';
import { DirectResourceService } from '../../src/services/resource-service';

window.mermaid = mermaid;
// Render engines need bundled fonts/stencils, not file or application access.
globalThis.platform = {
  resource: new DirectResourceService(path => new URL(path, 'documd://render/assets/').href),
} as unknown as typeof globalThis.platform;
initRenderEnvironment();
declare global { interface Window { renderHost: typeof handleRender; } }
window.renderHost = (request: RenderRequest) => handleRender(request);
